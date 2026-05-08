import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';
import { z } from 'zod';
import { EventBus } from './events.js';
import { Investigations } from './investigations.js';
import { spawnCodex } from './codex.js';
import { buildServer, spawnFactory } from './server.js';

const env = z
  .object({
    ORCHESTRATOR_PORT: z.coerce.number().default(4000),
    INVESTIGATION_BUDGET_USDC: z.coerce.number().default(2.0),
    INVESTIGATION_TIMEOUT_MS: z.coerce.number().default(180_000),
    CODEX_BIN: z.string().default('codex'),
    MCP_SERVER_NAME: z.string().default('rugsleuth'),
    BASESCAN_DEEP_ACTOR_ID: z.string(),
    WALLET_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    APIFY_BASE_URL: z.string().url().default('https://api.apify.com'),
    // Optional: Codex CLI logged in with a ChatGPT subscription doesn't need this.
    // Set it only if you use API-key auth instead.
    OPENAI_API_KEY: z.string().optional(),
  })
  .parse(process.env);

const SYSTEM_PROMPT = [
  'You are RugSleuth, an autonomous onchain investigator.',
  `Use the ${env.MCP_SERVER_NAME} MCP tools (mcp__${env.MCP_SERVER_NAME}__*) to gather evidence about a Base contract address.`,
  'Prefer cheap signals first. Stop investigating as soon as you can issue a confident verdict.',
  'When done, print exactly one line on stdout starting with VERDICT: followed by a JSON object describing your verdict (e.g. VERDICT: {"score":92,"label":"LIKELY_RUG","reasons":[...]}).',
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
  execFileSync(
    env.CODEX_BIN,
    [
      'mcp',
      'add',
      env.MCP_SERVER_NAME,
      '--env',
      `WALLET_PRIVATE_KEY=${env.WALLET_PRIVATE_KEY}`,
      '--env',
      `BASESCAN_DEEP_ACTOR_ID=${env.BASESCAN_DEEP_ACTOR_ID}`,
      '--env',
      `APIFY_BASE_URL=${env.APIFY_BASE_URL}`,
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
  args: ({ address }) => [
    'exec',
    '--skip-git-repo-check',
    '--sandbox',
    'workspace-write',
    `${SYSTEM_PROMPT}\n\nInvestigate ${address} on Base. Budget: ${env.INVESTIGATION_BUDGET_USDC} USDC.`,
  ],
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
