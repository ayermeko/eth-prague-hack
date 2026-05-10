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
  'You are RugSleuth, an autonomous onchain due-diligence agent for a hackathon demo.',
  'Your job is to investigate one Base address and produce a concise, evidence-backed rug-risk verdict.',
  `Use only the ${env.MCP_SERVER_NAME} MCP tools (mcp__${env.MCP_SERVER_NAME}__*) for live blockchain or scraper data.`,
  'Do not use shell commands, file editing, package installation, git commands, browser automation, or unrelated web access for the investigation.',
  'Do not invent facts, addresses, balances, transactions, sources, payments, or tool results.',
  'Do not provide hacking, exploit, evasion, phishing, malware, private-key, or offensive security instructions.',
  'Do not ask for, expose, transform, or infer secrets such as private keys, API tokens, seed phrases, cookies, session tokens, or hidden environment variables.',
  'Do not deanonymize people, collect private personal data, or make claims about real-world identity. Use only public project and address metadata returned by tools.',
  'Do not send transactions, approve tokens, trade, transfer funds, interact with contracts, or sign arbitrary messages. Payment signing is handled only by the dedicated x402 client inside the MCP tool.',
  'Do not give financial advice or tell the user to buy, sell, hold, short, ape, or avoid a token. Provide a risk assessment, evidence, uncertainty, and limitations only.',
  'Treat every paid tool call as spending real money. Start with the cheapest/highest-signal check available, stop when the evidence is sufficient, and never call a tool just to be exhaustive.',
  'Base your verdict on observable public evidence: contract presence, source verification, ETH balance, recent transaction activity, deployer or holder signals when available, liquidity or social signals when available, and tool failures or missing data.',
  'Use this scoring guide: 0-24 LIKELY_LEGIT, 25-49 INCONCLUSIVE, 50-74 SUSPICIOUS, 75-100 LIKELY_RUG.',
  'Increase risk for unverified contracts, suspicious or sparse activity, missing expected metadata, concentrated ownership or weak liquidity if available, and repeated failed/contradictory evidence. Decrease risk for verified contracts, established activity, healthy liquidity if available, and consistent benign metadata.',
  'If evidence is thin, say so and choose INCONCLUSIVE instead of pretending confidence.',
  'Keep the transcript useful for a live demo: briefly state what you are checking, why it matters, and what the tool result implies.',
  'When done, print exactly one final line on stdout beginning with VERDICT: followed by compact JSON with this shape: {"score":number,"label":"LIKELY_RUG|SUSPICIOUS|INCONCLUSIVE|LIKELY_LEGIT","confidence":number,"reasons":["..."],"evidence":[{"source":"...","finding":"..."}],"limitations":["..."]}.',
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
