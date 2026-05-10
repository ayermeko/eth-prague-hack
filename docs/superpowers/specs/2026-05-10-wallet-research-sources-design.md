# Wallet research sources — design

**Date:** 2026-05-10
**Status:** Draft (brainstorming output, awaiting user review)
**Owner:** RugSleuth orchestrator + rugcheck-mcp

## 1. Goal & scope

Build a wallet-reputation toolkit the Codex investigator can call when given a deployer / EOA address. Four new MCP tools surface complementary signals — social presence, on-chain deployment history, scam blacklists, and funding-cluster — on top of the existing `scrape_basescan_address`. Verdict labels (`LIKELY_RUG / SUSPICIOUS / INCONCLUSIVE / LIKELY_LEGIT`) stay the same; the agent gets richer `reasons` and `evidence` to ground them.

**In scope:**
- Four new MCP tools in `services/rugcheck-mcp/src/tools/`.
- One new Apify Actor (`metasleuth-deep`).
- A new route in the existing `basescan-deep` Actor for deployer history.
- A small in-memory `WalletCache` module.
- One additive field on `tool.end` events (`cached?: boolean`).

**Out of scope:**
- Persistent storage. Cache is in-memory, lost on restart, matching the lifecycle of `EventBus`.
- New verdict labels.
- Cross-chain support. Base only for v1.
- Paid cluster providers (Arkham). Public-Actor-or-scrape only.

## 2. Architecture

```
                 ┌─────────────────────┐
                 │  Codex investigator │
                 └──────────┬──────────┘
                            │ MCP tool calls
                  ┌─────────┴─────────────────────────┐
                  ▼                                   ▼
   ┌────────────────────────────┐         (existing)
   │      rugcheck-mcp          │   scrape_basescan_address ──▶ basescan-deep Actor
   │  ─────────────────────     │
   │  scrape_x_mentions         │ ──▶ public X-scraper Apify Actor (x402)
   │  list_deployer_contracts   │ ──▶ basescan-deep Actor (extended route)
   │  check_scam_blacklists     │ ──▶ direct HTTP: GoPlus + ScamSniffer JSON (free)
   │  analyze_wallet_cluster    │ ──▶ NEW metasleuth-deep Apify Actor (x402)
   │                            │
   │  + WalletCache (in-memory) │   ◀─ TTL per tool, keyed by wallet
   │  + emit() ─▶ EventBus      │   ◀─ same SSE stream the dashboard reads today
   └────────────────────────────┘
```

**Shape decisions:**

- Each new tool is its own file in `services/rugcheck-mcp/src/tools/`, mirroring `scrape-basescan-address.ts`. Pure functions taking `actorClient` / `fetch` injected — easy to fake in tests.
- Three of the four new tools (`scrape_x_mentions`, `list_deployer_contracts`, `analyze_wallet_cluster`) flow through the existing `ApifyActorClient` and reuse the `@rugsleuth/x402-client` payment path. They emit `payment` events identically to today.
- `check_scam_blacklists` bypasses Apify (free APIs / static GitHub JSON) and emits no payment events.
- `WalletCache` is a small `Map`-backed module sibling to `EventBus`. It wraps tool calls via a thin `withCache(tool, ttl)` adapter at registration time so the tool functions stay free of caching concerns.

## 3. The four MCP tools

### 3.1 `scrape_x_mentions`

**Backed by:** a public Apify X scraper. Candidate Actors: `apidojo/twitter-scraper-lite`, `kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest`. Final pick at implementation time based on x402 + PPE compatibility. Configurable via env `X_SCRAPER_ACTOR_ID`.

**Input:**
```ts
{ address: string; maxTweets?: number /* default 25 */ }
```

**Behavior:** runs up to two queries against the Actor:
1. Literal `"<address>"` — finds tweets pasting the wallet address (shillers, scam reports). Always runs.
2. If a Twitter handle can be discovered from the BaseScan public-name-tag string (e.g. matches `@[a-zA-Z0-9_]{1,15}`), also `from:<handle>`. Best-effort, no RPC calls in v1; ENS reverse-record lookup is deferred.

**Output:**
```ts
{
  address: string;
  literalMentions: Array<{
    author: string;
    handle: string;
    text: string;
    url: string;
    createdAt: string;       // ISO
    likeCount: number;
    replyCount: number;
  }>;
  authoredByLinkedHandle: Array<…same shape…>;  // empty if no linked handle
  facts: {
    mentionCount: number;
    linkedHandle: string | null;
  };
  payments: PaymentEvent[];
}
```

No scam/shill heuristics — Codex reasons over the raw tweet text.

### 3.2 `list_deployer_contracts`

**Backed by:** new route in the existing `basescan-deep` Actor (cheap to add, same Playwright crawler).

**Input:**
```ts
{ address: string; maxContracts?: number /* default 25 */ }
```

**Behavior:** loads `https://basescan.org/address/<address>`, drills into the **Contract Creator** view (or `txlistinternal` filtered to contract-creation internal txs). For each contract found, fetches an overview (verified? source code? holder count?).

**Output:**
```ts
{
  address: string;
  totalContractsDeployed: number;
  contracts: Array<{
    contractAddress: string;
    deployedAt: string;             // ISO
    isVerified: boolean;
    name: string | null;            // from verified source
    holderCount: number | null;
    suspicious: boolean;            // unverified + young + low-holder
  }>;
  signals: {
    deployerAgeDays: number;        // first tx → now
    serialDeployer: boolean;        // > 5 contracts in < 30 days
    unverifiedRatio: number;        // 0..1
  };
  payments: PaymentEvent[];
}
```

**PPE billing:** one new event `deployer-history-fetched` covers the whole call (wallet page + all contract drill-downs). Pricing schema and dataset schema in `actors/basescan-deep/.actor/` updated accordingly.

### 3.3 `check_scam_blacklists`

**Backed by:** direct HTTPS, no Apify. Two free sources:
- **GoPlus** `https://api.gopluslabs.io/api/v1/address_security/<address>?chain_id=8453` — flags include `cybercrime`, `phishing_activities`, `mixer`, `sanctioned`.
- **ScamSniffer** raw blacklist JSON: `https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json`. The whole list is loaded once into a module-level `Set<address>` (separate from `WalletCache` — that one keys per-wallet tool results) and refreshed every 24h on the next call after expiry.

**Input:**
```ts
{ address: string }
```

**Output:**
```ts
{
  address: string;
  hits: Array<{
    source: 'goplus' | 'scamsniffer';
    flag: string;
    severity: 'low' | 'medium' | 'high';
  }>;
  clean: boolean;                     // true iff no hits
  sources: {
    goplus: 'ok' | 'error';
    scamsniffer: 'ok' | 'error';
  };
  payments: [];                       // free sources
}
```

`tool.start` / `tool.end` events still emit; no `payment` events.

### 3.4 `analyze_wallet_cluster`

**Backed by:** new Apify Actor `metasleuth-deep` we build, mirroring `basescan-deep`. Playwright crawler over `https://metasleuth.io/result/eth/<address>` (path may differ for Base — finalised in implementation). One PPE event `cluster-fetched` per call.

Fallback if MetaSleuth proves unscrapeable: Bubblemaps (`https://app.bubblemaps.io/base/token/<address>`). Bubblemaps is token-centric so less ideal for wallet reputation; treat as plan-B only.

**Input:**
```ts
{ address: string; maxRelated?: number /* default 20 */ }
```

**Output:**
```ts
{
  address: string;
  fundingSource: { kind: 'cex' | 'mixer' | 'bridge' | 'eoa' | 'unknown'; label: string | null } | null;
  relatedWallets: Array<{
    address: string;
    relationship: 'funded_by' | 'funds' | 'cluster_peer';
    txCount: number;
  }>;
  signals: {
    funderIsMixer: boolean;
    funderIsKnownScammer: boolean;
    clusterSize: number;
  };
  payments: PaymentEvent[];
}
```

This is the highest-risk component (JS-heavy SPA scraping). All enrichment fields are nullable; the tool always returns at minimum `{ address, fundingSource: null, relatedWallets: [], signals: { funderIsMixer: false, funderIsKnownScammer: false, clusterSize: 0 } }` so it degrades gracefully.

## 4. In-memory cache (`WalletCache`)

Sibling module to `EventBus` in `services/rugcheck-mcp/src/`. Keyed by `(walletAddress, toolName)`.

**TTLs:**

| Tool                       | TTL  | Reason                                              |
|----------------------------|------|-----------------------------------------------------|
| `scrape_x_mentions`        | 6h   | Social signal moves, but not minute-by-minute       |
| `list_deployer_contracts`  | 1h   | New deployments are the highest-value churn         |
| `check_scam_blacklists`    | 24h  | Slow-moving lists                                   |
| `analyze_wallet_cluster`   | 24h  | Funding flows are largely historical                |

**Module shape:**
```ts
export class WalletCache {
  private readonly store = new Map<string, { value: unknown; expiresAt: number }>();
  get<T>(wallet: string, tool: string): T | null;
  set(wallet: string, tool: string, value: unknown, ttlMs: number): void;
}
```

**Wrapping discipline:** `withCache(tool, ttl)` adapter at the tool-registration site. Tool functions stay pure and unaware of the cache. On a cache hit, the adapter:
- Skips the Actor / HTTP call.
- Emits `tool.start` and `tool.end` with `cached: true`.
- Emits no `payment` events.

## 5. Events / SSE integration

No changes to `EventBus` or to existing `InvestigationEvent` kinds. The new tools call the existing `emit()` from `services/rugcheck-mcp/src/events.ts` with the same `tool.start | tool.end | payment` shapes used today. Dashboard timeline gets new cards for free.

**One additive change:** extend `tool.end` with an optional `cached?: boolean` field. Backward-compatible — existing consumers ignore the new field, the dashboard renders a small "cached" pill when true.

## 6. Error handling

Soft-fail contract identical to `wallet.ts` and `scrape-basescan-address.ts`: every tool returns a structured result, never throws past the MCP boundary.

- **Apify-backed tools** (`scrape_x_mentions`, `list_deployer_contracts`, `analyze_wallet_cluster`): catch around `actorClient.runActor()`. On failure emit `tool.end` with `ok: false, error: <message>` and return an empty-but-typed result (empty arrays, default signals). Codex sees an empty signal, not an exception.
- **Direct-HTTP tool** (`check_scam_blacklists`): per-source isolation — if GoPlus 5xx's, ScamSniffer still answers. Result includes a `sources: { goplus, scamsniffer }` block listing which responded.
- **Cluster scraper**: all enrichment fields nullable; tool always returns the minimum-shape object on any failure mode.
- **Budget cap:** existing `budget.exceeded` flow already covers new tools because they all flow through the same x402 client. The free blacklist tool emits no payments and therefore does not contribute to spend.

## 7. Testing

Mirrors existing patterns (`services/orchestrator/test/wallet.test.ts`, `actors/basescan-deep/test/main.test.ts`).

- **Unit, per tool**: pass a fake `actorClient` / fake `fetch` returning fixture JSON. Assert: shape of return value; that `tool.start` + `tool.end` were emitted; that `payment` events forward correctly; that errors are caught into structured `ok: false` ends. ~20 cases across the four tools.
- **`WalletCache` unit tests**: get-miss, get-hit, get-expired, two tools don't collide on key.
- **Actor tests** for new `metasleuth-deep`: one fixture HTML file, one Playwright route handler test asserting selector extraction — same shape as `actors/basescan-deep/test/main.test.ts`.
- **Integration smoke**: extend `scripts/e2e-mock.sh` to start orchestrator with a fake-Actor URL and confirm an investigation produces the expected sequence of `tool.start` → `tool.end` events across all five tools (existing + four new).
- **Coverage target**: ≥ 80% on `services/rugcheck-mcp/src/tools/*` and the new `WalletCache` module.
- **No live network in CI**: every test uses fakes; no real GoPlus / X / MetaSleuth calls.

## 8. Affected files (preview)

New files:
- `services/rugcheck-mcp/src/tools/scrape-x-mentions.ts`
- `services/rugcheck-mcp/src/tools/list-deployer-contracts.ts`
- `services/rugcheck-mcp/src/tools/check-scam-blacklists.ts`
- `services/rugcheck-mcp/src/tools/analyze-wallet-cluster.ts`
- `services/rugcheck-mcp/src/wallet-cache.ts`
- `services/rugcheck-mcp/test/*.test.ts` (one per tool + cache)
- `actors/metasleuth-deep/` (new Actor: `src/main.ts`, `src/routes.ts`, `.actor/*.json`, `test/`)

Modified files:
- `actors/basescan-deep/src/routes.ts` — add deployer-history route
- `actors/basescan-deep/.actor/pricing_schema.json` — add `deployer-history-fetched` event
- `actors/basescan-deep/.actor/dataset_schema.json` — extend output shape
- `services/rugcheck-mcp/src/index.ts` — register new tools through `withCache`
- `services/rugcheck-mcp/src/events.ts` — extend `tool.end` with optional `cached?: boolean`
- `apps/dashboard/lib/useInvestigation.ts` — render `cached` pill (UI polish, optional in v1)
- `scripts/e2e-mock.sh` — extended fake fixtures for the new tools

## 9. Open questions for implementation phase

1. Final pick of public X scraper Actor (depends on which currently supports x402 + PPE in production).
2. Exact MetaSleuth URL pattern for Base addresses — verify during Actor scaffolding.
3. Whether `cached` pill in dashboard ships in this PR or a follow-up.
