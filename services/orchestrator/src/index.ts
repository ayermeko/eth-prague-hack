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
  'Use the rugcheck-mcp tools to gather evidence about a Base contract address.',
  'Prefer cheap signals first. Stop investigating as soon as you can issue a confident verdict.',
  'When done, print a final JSON line on stdout: {"verdict": {...}}.',
].join(' ');

const bus = new EventBus();

const spawn = spawnFactory({
  command: env.CODEX_BIN,
  args: ({ address }) => [
    '--mcp-server',
    'rugsleuth=npx --workspace services/rugcheck-mcp rugcheck-mcp',
    '--system',
    SYSTEM_PROMPT,
    '--input',
    `Investigate ${address} on Base. Budget: ${env.INVESTIGATION_BUDGET_USDC} USDC.`,
  ],
  env: {
    ...(env.OPENAI_API_KEY ? { OPENAI_API_KEY: env.OPENAI_API_KEY } : {}),
    WALLET_PRIVATE_KEY: env.WALLET_PRIVATE_KEY,
    APIFY_BASE_URL: env.APIFY_BASE_URL,
    BASESCAN_DEEP_ACTOR_ID: env.BASESCAN_DEEP_ACTOR_ID,
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
