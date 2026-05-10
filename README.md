# RugSleuth

*An autonomous on-chain investigator that pays for its own intel via x402.*

> **ETH Prague 2026 — Apify Bounty submission**
> Active branch: `feat/wallet-research-sources`

You paste a Base contract or wallet address. RugSleuth — an autonomous Codex agent with its own USDC wallet on Base — investigates it live. It buys on-chain data, social signals, and reputation lookups by paying Apify Actors per call via the **x402** protocol. After ~30–90 seconds it returns a forensic dossier and a verdict: `LIKELY_RUG / SUSPICIOUS / INCONCLUSIVE / LIKELY_LEGIT`.

The agent is not a hand-rolled LLM loop. It runs inside **Codex CLI** with our paid scrapers exposed via a custom **MCP server** (`rugcheck-mcp`). Codex picks what to investigate, recovers from failures, and decides when it has enough evidence.

---

## What's in this branch

The original demo shipped one MCP tool (`scrape_basescan_address`). This branch adds a **wallet-reputation toolkit** so the agent can do real deployer/EOA forensics, not just contract overview:

### New MCP tools

| Tool | Backed by | Cost | Returns |
|---|---|---|---|
| `scrape_basescan_address` *(existing)* | Our `basescan-deep` Apify Actor (PPE) | x402 USDC | balance, contract status, recent txs |
| **`scrape_x_mentions`** | Public Apify X scraper (PPE, swap-able via env) | x402 USDC | raw tweets that paste the wallet address — let Codex reason over the text |
| **`list_deployer_contracts`** | `basescan-deep` Actor in new `deployer-history` mode | x402 USDC | every contract this wallet has deployed, with verification status, holder count, and signals (`serialDeployer`, `unverifiedRatio`, `deployerAgeDays`) |
| **`check_scam_blacklists`** | Direct HTTP — GoPlus `address_security` + ScamSniffer GitHub blacklist | **Free** | hit list + clean flag + per-source health |
| **`analyze_wallet_cluster`** | New `metasleuth-deep` Apify Actor (PPE) | x402 USDC | funding-source classification (cex / mixer / bridge / eoa / unknown) + related wallets |

### New supporting components

- **`WalletCache`** *(in-memory, TTL per tool)* — wraps each new tool via a `withCache` adapter. Repeat investigations of the same wallet within 6h–24h skip the paid Actor call entirely.
- **`shouldCache` predicates** — every tool also passes a predicate to `withCache` so soft-fail empty results (transient Actor errors) are *not* cached. A bad call doesn't poison the cache for 24 hours.
- **`tool.end` event extension** — added optional `cached?: boolean` field. When the dashboard sees `cached: true`, it can render a "served from cache" pill (UI integration left for v1.1).
- **`metasleuth-deep` Apify Actor** — brand-new Playwright scraper, full PPE pricing schema, mirrors the `basescan-deep` toolchain.
- **`basescan-deep` deployer-history mode** — second route in the existing Actor, charges a separate `deployer-history-fetched` PPE event ($0.08).
- **End-to-end smoke test** *(`scripts/e2e-mock.sh`)* — extended to assert all five tools fire `tool.start` + `tool.end` over the SSE stream, with no live network calls (GoPlus / ScamSniffer URLs are env-overridable to a local mock).

### Spec & plan

- Design spec: `docs/superpowers/specs/2026-05-10-wallet-research-sources-design.md`
- Implementation plan (15 tasks, 14 landed): `docs/superpowers/plans/2026-05-10-wallet-research-sources.md`

---

## Repo layout

```
eth-prague-hack/
├── apps/
│   └── dashboard/              ← Next.js UI, SSE event feed, verdict card
├── services/
│   ├── orchestrator/           ← Fastify, spawns Codex per investigation, streams events
│   └── rugcheck-mcp/           ← MCP server exposing 5 tools to Codex
│       ├── src/tools/          ← one file per tool + `with-cache.ts` adapter
│       ├── src/blacklists/     ← GoPlus + ScamSniffer (free HTTP)
│       └── src/wallet-cache.ts ← in-memory TTL cache
├── packages/
│   └── x402-client/            ← viem-based x402 protocol client
├── actors/
│   ├── basescan-deep/          ← Apify Actor (address page + deployer history)
│   └── metasleuth-deep/        ← Apify Actor (wallet-cluster scraping)
├── scripts/
│   ├── e2e-mock.sh             ← end-to-end smoke test
│   └── fake-codex.mjs          ← stand-in Codex for the smoke test
└── docs/
    └── superpowers/            ← spec + plan for this branch
```

---

## Quick start

### Prerequisites

```bash
node --version    # v20+
npm --version     # v10+
which codex       # OpenAI Codex CLI installed and `codex login` done
```

### 1. Install + configure

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local` — at minimum set `APIFY_TOKEN` and `BASESCAN_DEEP_ACTOR_ID`. To use real x402 wallet payments instead of an Apify token, switch `APIFY_PAYMENT_MODE=x402` and set `WALLET_PRIVATE_KEY` (a 0x-prefixed 64-hex private key holding USDC on Base).

### 2. Start the app

Two long-running dev servers in separate terminals:

```bash
# Terminal 1 — rebuilds rugcheck-mcp, starts the orchestrator on :4000
npm run dev:orchestrator

# Terminal 2 — starts the Next.js dashboard on :3000
npm run dev:dashboard
```

Open http://localhost:3000 and paste a Base address. The orchestrator spawns a Codex process per investigation; events stream live to the dashboard via SSE.

Health check:

```bash
curl -s http://localhost:4000/health   # → {"ok":true}
```

---

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `APIFY_PAYMENT_MODE` | `x402` | `token` (Apify account credits) or `x402` (USDC wallet on Base) |
| `APIFY_TOKEN` | — | Required when mode is `token` |
| `WALLET_PRIVATE_KEY` | — | Required when mode is `x402` (0x + 64 hex chars) |
| `APIFY_BASE_URL` | `https://api.apify.com` | Override for testing |
| `BASESCAN_DEEP_ACTOR_ID` | — | Required — your published `basescan-deep` Actor (e.g. `username/basescan-deep`) |
| `X_SCRAPER_ACTOR_ID` | `apidojo/twitter-scraper-lite` | Public X-scraper Actor for `scrape_x_mentions` |
| `METASLEUTH_DEEP_ACTOR_ID` | `rugsleuth/metasleuth-deep` | Your published cluster Actor |
| `GOPLUS_CHAIN_ID` | `8453` | Base mainnet |
| `GOPLUS_BASE_URL` | `https://api.gopluslabs.io` | Override for e2e tests / network isolation |
| `SCAMSNIFFER_URL` | GitHub raw blacklist | Override for e2e tests |
| `ORCHESTRATOR_PORT` | `4000` | |
| `INVESTIGATION_BUDGET_USDC` | `2.00` | Hard cap; orchestrator kills Codex if exceeded |
| `INVESTIGATION_TIMEOUT_MS` | `180000` | Hard timeout per investigation |
| `OPENAI_API_KEY` | optional | Codex CLI also accepts subscription auth |

---

## How to test

### Unit tests

```bash
# All packages, all tests
npm test

# Per package
npx vitest run services/rugcheck-mcp/test     # 30 tests across 10 files
cd actors/basescan-deep   && npx vitest run   # 2 tests (address mode + deployer-history mode)
cd actors/metasleuth-deep && npx vitest run   # 2 tests (cluster scrape + graceful degradation)
cd services/orchestrator  && npx vitest run   # 5 tests (config, codex, validation, etc.)
```

What's covered:

- **`WalletCache`** — miss / hit / TTL expiry / per-tool isolation / case-insensitivity / non-positive TTL guard (6 tests)
- **`withCache` adapter** — miss-then-store / hit-skips-inner / failure-not-cached / `shouldCache` predicate skips empties (4 tests)
- **`scrape-x-mentions`** — literal-address query / from:handle branch / Actor failure soft-fail (3 tests)
- **`list-deployer-contracts`** — happy path / Actor failure soft-fail (2 tests)
- **`check-scam-blacklists`** — combined hits / clean / partial-source-error (3 tests)
- **`analyze-wallet-cluster`** — happy path / Actor failure soft-fail (2 tests)
- **GoPlus client** — severity mapping / upstream failure (2 tests)
- **ScamSniffer client** — case-insensitive lookup / TTL refresh / fail-soft on HTTP error (3 tests)
- **`basescan-deep`** Actor — original address-page scrape + new deployer-history extraction with charge assertion
- **`metasleuth-deep`** Actor — funding-source + related-wallets extraction; degrades gracefully on empty pages

### End-to-end smoke test

Single shell script that spins up the full stack against a local mock x402 server, fires an investigation, and asserts every MCP tool emits start/end events over SSE — no live network:

```bash
bash scripts/e2e-mock.sh
```

What it asserts:
- Mock x402 server resolves payments
- All 5 tools (`scrape_basescan_address`, `scrape_x_mentions`, `list_deployer_contracts`, `check_scam_blacklists`, `analyze_wallet_cluster`) fire `tool.start` + `tool.end` events
- Final `verdict.rendered` and `investigation.completed` events emit
- No outbound HTTPS to `api.gopluslabs.io` or `raw.githubusercontent.com` (they're routed to the mock)

### Manual dashboard test

1. `npm run dev:orchestrator` + `npm run dev:dashboard`
2. Open http://localhost:3000
3. Paste a Base address (e.g. `0xc1fcc4300305a415a7ea894f71a0694e9f7831d3`)
4. Click *Investigate*
5. Watch the SSE feed: each tool call streams `tool.start` → (`payment.required` → `payment.signed` → `payment.settled`)* → `tool.end`. Final `verdict.rendered` lands at the bottom.

To exercise the new wallet-research tools specifically, point Codex at a wallet (deployer EOA) instead of a contract — the rubric will lean on `list_deployer_contracts`, `check_scam_blacklists`, and `scrape_x_mentions`.

### Cache behaviour test

Re-investigate the same address within the cache TTL (e.g. 6h for X mentions, 24h for blacklists) and confirm:
- The Apify Actor is **not** re-called for cached tools (no `payment` events)
- `tool.end` events arrive with `cached: true`
- Total spend is lower than the first run

---

## Architecture

```
                    ┌────────────────────────────────────────┐
                    │     BROWSER  (Next.js dashboard)       │
                    └────────────────┬───────────────────────┘
                                     │ HTTP + SSE
                    ┌────────────────▼───────────────────────┐
                    │   ORCHESTRATOR  (Fastify + tsx watch)  │
                    │  • spawns codex per investigation      │
                    │  • parses RSEVT logs from rugcheck-mcp │
                    │  • enforces budget + timeout           │
                    └────────────────┬───────────────────────┘
                                     │ child process
                    ┌────────────────▼───────────────────────┐
                    │         CODEX CLI (GPT-5.x)            │
                    │  Decides which MCP tools to call       │
                    └────────────────┬───────────────────────┘
                                     │ MCP / stdio
                    ┌────────────────▼───────────────────────┐
                    │   rugcheck-mcp                         │
                    │   ┌──────────────────────────────┐     │
                    │   │ scrape_basescan_address      │ ──┐ │
                    │   │ scrape_x_mentions            │   │ │
                    │   │ list_deployer_contracts      │   │ │
                    │   │ check_scam_blacklists        │   │ │
                    │   │ analyze_wallet_cluster       │   │ │
                    │   └──────────────────────────────┘   │ │
                    │   • WalletCache (TTL per tool)       │ │
                    │   • withCache + shouldCache predicate│ │
                    │   • emit() → RSEVT-prefixed stderr   │ │
                    └────────────┬─────────────────────────┴─┘
                                 │
              ┌──────────────────┼─────────────────────────────┐
              │                  │                             │
       ┌──────▼──────┐    ┌──────▼─────┐               ┌───────▼─────┐
       │ x402-client │    │ direct fetch │              │ direct fetch │
       │   (viem)    │    │ (free APIs) │              │ (free APIs) │
       └──────┬──────┘    └──────┬─────┘               └─────────────┘
              │                  │
              │                  ├─ GoPlus address_security
              │                  └─ ScamSniffer raw blacklist
              │
       ┌──────▼─────────────────────────────┐
       │       APIFY PLATFORM (PPE)          │
       │  • basescan-deep   (us)             │
       │  • metasleuth-deep (us)             │
       │  • twitter-scraper-lite (Store)     │
       └────────────────┬───────────────────┘
                        │
                Base mainnet — USDC settlement
```

---

## Verdict format

```ts
interface Verdict {
  investigationId: string;
  contractAddress: `0x${string}`;
  chain: 'base';
  score: number;                  // 0..100
  label: 'LIKELY_RUG' | 'SUSPICIOUS' | 'INCONCLUSIVE' | 'LIKELY_LEGIT';
  reasons: string[];              // ≥ 3 short citable strings
  evidence: Array<{ source: string; finding: string; costUsdc: string }>;
  durationSec: number;
  spend: {
    totalUsdc: string;
    breakdown: { tool: string; usdc: string }[];
  };
  completedAt: string;
}
```

---

## Branches

| Branch | Status | What's in it |
|---|---|---|
| `main` | base | initial demo + bounty PRD |
| `feat/wallet-and-orchestrator` | merged on remote | wallet card, orchestrator scaffolding |
| **`feat/wallet-research-sources`** | **active** | this README, four new MCP tools, cache layer, metasleuth Actor, e2e smoke test |

---

## Known follow-ups

From the final code review (all HIGH issues resolved; these are MEDIUM/LOW):

- Tool unit tests don't fully verify `tool.start`/`tool.end` event emission via stderr spy.
- `metasleuth-deep` route handler always returns `funderIsKnownScammer: false` — needs cross-reference with `check_scam_blacklists`.
- `analyze_wallet_cluster` and `list_deployer_contracts` empty-dataset path (Actor returns `result: []`) is untested.
- Apify token is sent as URL query param (`?token=...`) instead of `Authorization` header in the token-mode client.
- `metasleuth-deep` Actor lacks a public-facing `README.md` (the project's own AGENTS.md says always ship one).
- Hard-coded `page.waitForTimeout(2000)` in the cluster scraper — fragile against slow proxy routes; should use `waitForSelector` instead.
- Optional dashboard "cached" pill (Task 15 in the plan) was deferred.

---

## References

- **Apify x402:** https://docs.apify.com/platform/integrations/x402
- **Apify Actors:** https://docs.apify.com/platform/actors
- **MCP spec:** https://modelcontextprotocol.io
- **viem:** https://viem.sh
- **Codex CLI:** https://github.com/openai/codex

---

*Bounty submission — autonomous agent paying per-call for its own intelligence via x402 USDC on Base.*
