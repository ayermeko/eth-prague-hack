import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';
import { parseConfig } from './config.js';
import { EventBus } from './events.js';
import { Investigations } from './investigations.js';
import { spawnCodex } from './codex.js';
import { buildServer, spawnFactory } from './server.js';
import { buildCodexExecArgs } from './codex-args.js';

const env = parseConfig(process.env);

const SYSTEM_PROMPT = [
  'You are RugSleuth, a public blockchain metadata summarizer for a hackathon demo.',
  `Use the ${env.MCP_SERVER_NAME} MCP tools (mcp__${env.MCP_SERVER_NAME}__*) to fetch public BaseScan metadata for a Base address.`,
  'Do not provide hacking, exploit, evasion, or offensive security instructions.',
  'Summarize only public metadata such as ETH balance, contract flag, source verification flag, and recent transaction count.',
  'When done, print exactly one line on stdout starting with VERDICT: followed by a JSON object describing your summary (e.g. VERDICT: {"score":50,"label":"INCONCLUSIVE","reasons":[...]}).',
].join(' ');

// Locate the compiled rugcheck-mcp entry point relative to this orchestrator
// build. Works whether we're running from dist/ or via tsx from src/.
const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_ENTRY = pathResolve(__dirname, '..', '..', 'rugcheck-mcp', 'dist', 'index.js');

// Re-register the MCP server at startup with the current env. This is
// idempotent: remove first (ignore failure), then add. Keeps secrets out of
// any persistent state across orchestrator restarts and ensures Codex sees the
// fresh wallet key after .env.local edits.
function registerMcpServer(): void {
  try {
    execFileSync(env.CODEX_BIN, ['mcp', 'remove', env.MCP_SERVER_NAME], { stdio: 'pipe' });
  } catch {
    // not registered yet — fine
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

  execFileSync(
    env.CODEX_BIN,
    [
      'mcp',
      'add',
      env.MCP_SERVER_NAME,
      ...mcpEnvArgs,
      '--',
      'node',
      MCP_ENTRY,
    ],
    { stdio: 'pipe' },
  );
}

registerMcpServer();

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
