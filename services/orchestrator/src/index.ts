import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { parseConfig } from './config.js';
import { EventBus } from './events.js';
import { Investigations } from './investigations.js';
import { spawnCodex } from './codex.js';
import { buildServer, spawnFactory } from './server.js';
import { buildCodexExecArgs } from './codex-args.js';

// Resolve .env.local relative to this file (works for src/ via tsx and
// dist/ via node) since `npm --workspace` runs scripts with cwd set to the
// workspace, not the repo root. dotenv does not override variables already
// set, so process.env wins for CI / inline overrides.
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(__dirname, '..', '..', '..');
loadDotenv({ path: pathResolve(REPO_ROOT, '.env.local') });
loadDotenv({ path: pathResolve(REPO_ROOT, '.env') });

const env = parseConfig(process.env);

const SYSTEM_PROMPT = [
  'You are RugSleuth, an autonomous Base-chain investigator for a public hackathon demo.',
  `Use the ${env.MCP_SERVER_NAME} MCP tools (mcp__${env.MCP_SERVER_NAME}__*) to fetch public BaseScan metadata about a Base address. Do not call any other tool or browse the network outside MCP.`,
  'Stop spending as soon as you have enough evidence; you do not need to use the whole budget.',
  'Only summarize public metadata (ETH balance, contract flag, source verification, recent tx count). No hacking, exploit, evasion, or offensive-security guidance, and no PII enrichment.',
  '',
  'When you are done, print EXACTLY ONE line on stdout starting with the prefix `VERDICT:` followed by a single JSON object on the same line, with this shape:',
  '',
  'VERDICT: {"score":<integer 0-100>,"label":"LIKELY_RUG"|"SUSPICIOUS"|"INCONCLUSIVE"|"LIKELY_LEGIT","confidence":"low"|"medium"|"high","reasons":["one-sentence finding", ...],"evidence":[{"source":"BaseScan","finding":"what you observed","costUsdc":"0.05"}, ...],"durationSec":<integer>}',
  '',
  'Score scale: 0-25 LIKELY_LEGIT, 26-50 INCONCLUSIVE, 51-75 SUSPICIOUS, 76-100 LIKELY_RUG. Higher = more rug-like. Be evidence-driven; do not invent facts you did not observe. If a tool failed and you have nothing, return INCONCLUSIVE with confidence "low" and an empty evidence array.',
  'After printing the VERDICT line, exit cleanly.',
].join('\n');

// Locate the compiled rugcheck-mcp entry point. Works whether we're running
// from dist/ or via tsx from src/ since REPO_ROOT was resolved above.
const MCP_ENTRY = pathResolve(REPO_ROOT, 'services', 'rugcheck-mcp', 'dist', 'index.js');

// Re-register the MCP server at startup with the current env. Idempotent:
// remove first (ignore failure), then add. Soft-fails so the HTTP server can
// still boot for the demo path even when codex is missing or the wallet key
// is unset; a real investigation will surface the missing piece at request
// time.
function registerMcpServer(): { ok: boolean; reason?: string } {
  // Always clear any prior registration so a stale wallet key from an earlier
  // run cannot quietly sign payments. Soft-fails if codex is missing.
  try {
    execFileSync(env.CODEX_BIN, ['mcp', 'remove', env.MCP_SERVER_NAME], { stdio: 'pipe' });
  } catch {
    // not registered yet, or codex CLI missing — both fine here.
  }

  if (env.APIFY_PAYMENT_MODE === 'x402' && !env.WALLET_PRIVATE_KEY) {
    return { ok: false, reason: 'WALLET_PRIVATE_KEY is unset; live x402 runs will fail until you set it in .env.local' };
  }
  if (env.APIFY_PAYMENT_MODE === 'token' && !env.APIFY_TOKEN) {
    return { ok: false, reason: 'APIFY_TOKEN is unset; live token-mode runs will fail until you set it' };
  }

  const mcpEnvArgs = [
    '--env',
    `APIFY_PAYMENT_MODE=${env.APIFY_PAYMENT_MODE}`,
    '--env',
    `BASESCAN_DEEP_ACTOR_ID=${env.BASESCAN_DEEP_ACTOR_ID}`,
    '--env',
    `APIFY_BASE_URL=${env.APIFY_BASE_URL}`,
  ];

  if (env.APIFY_PAYMENT_MODE === 'token') {
    mcpEnvArgs.push('--env', `APIFY_TOKEN=${env.APIFY_TOKEN}`);
  } else {
    mcpEnvArgs.push('--env', `WALLET_PRIVATE_KEY=${env.WALLET_PRIVATE_KEY}`);
  }

  try {
    execFileSync(
      env.CODEX_BIN,
      ['mcp', 'add', env.MCP_SERVER_NAME, ...mcpEnvArgs, '--', 'node', MCP_ENTRY],
      { stdio: 'pipe' },
    );
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `codex mcp add failed: ${message}` };
  }
}

const mcpRegistration = registerMcpServer();
if (!mcpRegistration.ok) {
  // eslint-disable-next-line no-console
  console.warn(`[orchestrator] MCP not registered — ${mcpRegistration.reason}`);
  // eslint-disable-next-line no-console
  console.warn('[orchestrator] HTTP server will still boot; the dashboard demo button works without MCP.');
}

const bus = new EventBus();

const spawn = spawnFactory({
  command: env.CODEX_BIN,
  args: ({ address }) =>
    buildCodexExecArgs({
      address,
      budgetUsdc: env.INVESTIGATION_BUDGET_USDC,
      systemPrompt: SYSTEM_PROMPT,
    }),
  env: {
    ...(env.OPENAI_API_KEY ? { OPENAI_API_KEY: env.OPENAI_API_KEY } : {}),
  },
  bus,
  spawnCodex,
});

const investigations = new Investigations(bus, {
  spawn,
  budgetUsdc: env.INVESTIGATION_BUDGET_USDC,
  timeoutMs: env.INVESTIGATION_TIMEOUT_MS,
});

const app = buildServer({ bus, investigations });
await app.listen({ port: env.ORCHESTRATOR_PORT, host: '0.0.0.0' });
