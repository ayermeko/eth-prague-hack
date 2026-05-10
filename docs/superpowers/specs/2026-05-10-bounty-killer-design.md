# RugSleuth — bounty-killer design (ETH Prague 2026 Apify x402 bounty)

**Status:** validated through brainstorming on 2026-05-10. Awaiting user approval before implementation plan.
**Bounty:** Apify x402 — judge: Jakub Kopecky (Apify x402 protocol owner).
**Bounty criteria:** (1) relevancy of use case, (2) functionality + successful demo of payment, (3) creativity of integration.

## 1. Goal

Turn RugSleuth from "an autonomous agent that pays Apify for scraping" into "an autonomous on-chain micro-service that pays Apify for inputs *and* gets paid by other agents for its verdicts." The submission then hits **two** of the three example use cases in the bounty brief in one demo:

- *"Integration of Apify Actors inside agent payment frameworks"* (RugSleuth → Apify, outbound x402)
- *"Agent selling to other Agents Apify services"* (Buyer agent → RugSleuth, inbound x402)

The third creativity axis is the **two-tier pricing model** (Fresh / Cached) — a recognisable real-world micro-service pattern expressed natively in x402.

## 2. Strategic decisions (locked in)

| Decision | Choice |
|---|---|
| Strategic direction | Combine depth (more tools) + A2A (RugSleuth as paid service) |
| Buyer-agent representation | CLI script (~50 lines) — bulletproof, run live in a terminal |
| Apify tools to add | +2 on the same `basescan-deep` actor: `deployer-fetched`, `holders-fetched` |
| RugSleuth pricing | Fresh $0.50 / Cached $0.05 |
| Dashboard framing | Service-first / operator console |
| Build sequencing | Inside-out: submit Apify pricing day 1, build A2A + UI in parallel |

## 3. Architecture

```
                    ┌─────────────────────────────────────┐
                    │  Dashboard (Next.js, "operator UI") │
                    └────────────┬────────────────────────┘
                                 │  HTTP + SSE
                                 ▼
        ┌─────────────────────────────────────────────────┐
        │           Orchestrator (Fastify, single proc)   │
        │                                                 │
        │  Public x402-protected endpoints (NEW):         │
        │    POST /verdicts/fresh   ($0.50, fresh run)    │
        │    POST /verdicts/cached  ($0.05, cache hit)    │
        │                                                 │
        │  Service endpoints (NEW):                       │
        │    GET  /service/activity                       │
        │    GET  /service/cache                          │
        │                                                 │
        │  Internal endpoints (existing):                 │
        │    POST /investigations + SSE                   │
        │    GET  /agent/wallet                           │
        │                                                 │
        │  Verdict cache (in-memory, 1 h TTL)             │
        │  A2A activity log (last 50, in-memory)          │
        │                                                 │
        │  spawnCodex → uses 3 MCP tools                  │
        └─────┬───────────────────────────┬───────────────┘
              │ x402 OUT (pays Apify)     │ x402 IN (collected)
              ▼                           ▲
        ┌──────────────┐          ┌────────────────────┐
        │ Apify Actor  │          │ CLI buyer script   │
        │ basescan-deep│          │ (~50 lines, Node)  │
        │ 3 PPE events │          │ uses mcpc x402 sign│
        └──────────────┘          └────────────────────┘
```

### Architectural choices

- **Single process.** The orchestrator carries both inbound and outbound x402 flows. One source of truth for the verdict cache. No second deploy unit.
- **In-memory cache + activity log.** TTL 1 hour, ring buffer size 50. Lost on restart — fine for hackathon, easy upgrade to Redis later.
- **One wallet, two roles.** The mcpc-keychain wallet pays Apify on outbound calls and receives USDC on inbound calls. The dashboard wallet card already shows live balance; nothing to change there.
- **Inbound x402 via the public Coinbase facilitator** (`facilitator.coinbase.com/x402`). Lets us avoid hand-rolling EIP-3009 verification. We still own the 402 challenge generation + the post-settle business logic.
- **Fresh ≠ Cached short-circuit.** Cached endpoint never auto-upgrades to Fresh on miss; it 404s. Buyers picking the wrong tier don't get accidentally overcharged, and the demo can show explicit tier selection.

## 4. Tools and pricing

### 4.1 Three paid Apify tools (one actor, three PPE events)

| MCP tool | PPE event | Price | Returns |
|---|---|---|---|
| `scrape_basescan_address` | `address-fetched` | $0.05 | (existing) ETH balance, isContract, verified flag, 5 latest tx hashes |
| `scrape_basescan_deployer` | `deployer-fetched` | $0.10 | Deployer wallet's last-30d contract count, drained-within-24h count |
| `scrape_basescan_holders` | `holders-fetched` | $0.15 | Top 5 holders + % supply, LP holder identification, whale concentration ratio |

### 4.2 Per-investigation budget

`INVESTIGATION_BUDGET_USDC=1.00` (default). All three tools fully fired = $0.30 of spend, leaving headroom. The system prompt instructs the agent to stop early if confidence is high — the **visible decision moment** the demo highlights.

### 4.3 RugSleuth-as-service pricing

| Tier | Price | What buyer gets | RugSleuth's economics |
|---|---|---|---|
| Fresh | $0.50 | Always-new investigation, runs immediately. Never serves from cache. | Spends ~$0.30 on Apify, net margin ~$0.20 |
| Cached | $0.05 | Cached verdict if one exists for this address within the last hour. 404 otherwise. | Pure margin (zero Apify spend on a hit) |

A miss on `/verdicts/cached` returns 404 *before* x402 settles, so the buyer's $0.05 is not charged. (x402 only settles on a 200.)

## 5. A2A endpoint contract

### 5.1 `POST /verdicts/fresh`

Headers: `X-PAYMENT: <base64 EIP-3009 signed payload>`, `Content-Type: application/json`
Body: `{ "address": "0x..." }`

| Status | Body |
|---|---|
| 200 | `{ verdict: {...}, costUsdc: "0.50", cached: false, ageSec: 0, durationSec: 38 }` |
| 402 | `{ paymentRequired: { amount: "500000", asset: "USDC", network: "base", payTo, nonce, expiresAt } }` |
| 400 | `{ error: "invalid_address" }` |
| 503 | `{ error: "investigator_unavailable" }` |

### 5.2 `POST /verdicts/cached`

Same shape, but $0.05 challenge.

| Status | Body |
|---|---|
| 200 | `{ verdict: {...}, costUsdc: "0.05", cached: true, ageSec: 1247 }` |
| 402 | `{ paymentRequired: { amount: "50000", ... } }` |
| 404 | `{ error: "no_cache", hint: "use /verdicts/fresh ($0.50)" }` |

### 5.3 Flow on a fresh request

1. Buyer POSTs without payment → 402 with EIP-3009 challenge.
2. Buyer signs with their wallet (`mcpc x402 sign <challenge>` in our CLI script).
3. Buyer POSTs with `X-PAYMENT` header.
4. Orchestrator verifies signature, settles via Coinbase facilitator (≈3-5 s on Base).
5. Orchestrator runs `Investigations.start({ address })`, awaits `verdict.rendered` event.
6. Returns 200 with the verdict + cost + `cached: false`.
7. Stores verdict in cache (TTL 1 h).

### 5.4 CLI buyer script (`scripts/buy-verdict.mjs`)

```bash
node scripts/buy-verdict.mjs --address 0xc1f... --tier fresh
# → POST /verdicts/fresh ... 402 received
# → Challenge: pay 0.50 USDC to 0xRug...
# → Signing with mcpc keychain ...
# → Resending with X-PAYMENT ...
# → 200 OK in 38s
# → Verdict: { score: 78, label: "SUSPICIOUS", confidence: "medium", ... }
# → Spent: $0.50 USDC
```

~50 lines of Node. Uses `mcpc x402 sign` under the hood so we don't reimplement signing.

### 5.5 Activity log

In-memory ring buffer of the last 50 A2A requests:
`{ ts, tier, address, buyerLast4, costUsdc, cached, durationMs, status }`

Exposed via `GET /service/activity`. Lost on restart — fine for demo.

### 5.6 SSE bridge (deferred)

Fresh-tier flow is multi-second (Apify scrape + Codex reasoning). To avoid a hung-looking connection, the orchestrator can hold the request open and stream progress via SSE. **Not in v1**; add only if there's time after everything else lands.

## 6. Dashboard (operator console)

```
┌─ HEADER ─────────────────────────────────────────────────────────────────────┐
│ RUGSLEUTH                                  [● live]  mcpc 0xDf6…F57e         │
│ x402 autonomous investigation service                  $1.23 USDC + 0 ETH    │
└──────────────────────────────────────────────────────────────────────────────┘

┌─ SERVICE EARNINGS ──────────────────────────┬─ TOOL CATALOG (paid by RugSleuth)─┐
│  7 verdicts sold · $1.65 earned (24h)       │   $0.05  BaseScan address          │
│                                             │   $0.10  Deployer history          │
│  RECENT CALLS  (ts · tier · addr · buyer ·  │   $0.15  Top holders               │
│                 cost · verdict)             │   Budget per run: $1.00 USDC       │
│  ● 14s   FRESH   0xc1f…  ←0x4b3a  $0.50 SUS │                                    │
│  ● 3m    CACHED  0xc1f…  ←0x9c87  $0.05 SUS │                                    │
│  ● 12m   FRESH   0xab2…  ←0x4b3a  $0.50 OK  │                                    │
│  ● 38m   FRESH   0xdef…  ←0x2211  $0.50 RUG │                                    │
│  ● 1h    CACHED  0xdef…  ←0x77aa  $0.05 RUG │                                    │
└─────────────────────────────────────────────┴────────────────────────────────────┘

┌─ CACHE INVENTORY (next-call discount panel) ────────────────────────────────┐
│  3 verdicts cached, 1 h TTL                                                  │
│  • 0xc1f… (18 m old)  → SUSPICIOUS  78  | next cached call $0.05             │
│  • 0xab2… (42 m old)  → LIKELY_LEGIT 12 | next cached call $0.05             │
│  • 0xdef… (56 m old)  → LIKELY_RUG  94  | next cached call $0.05             │
└──────────────────────────────────────────────────────────────────────────────┘

┌─ RUN A LIVE INVESTIGATION  (operator / dev) ─────────────────────────────────┐
│  [0xc1fcc4300305a415a7ea894f71a0694e9f7831d3]    [Run demo]    [Live run]    │
└──────────────────────────────────────────────────────────────────────────────┘

┌─ WORKFLOW + EVENTS  (existing pieces, stay) ────────────────────────────────┐
│   Node graph · Event feed · Verdict card                                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 6.1 What's new vs today

1. **Header**: keeps mcpc wallet (now a chip, not a full card) — wallet still updates live as RugSleuth spends and earns.
2. **Service Earnings panel**: total sold + earned in last 24 h, rolling list of last 5 A2A calls. Reads `GET /service/activity`. Rows fade in as buyers call the endpoint — the **money moment** during the demo.
3. **Tool Catalog**: small static panel showing the three paid tools and prices. Tells the judge integration depth at a glance.
4. **Cache Inventory**: live list of cached verdicts with age + "next cached call $0.05" tag. Shows the cache-tier business logic visually.
5. **Live investigation row**: demoted to "operator/dev" framing. Same buttons (Run demo, Live run).
6. **Workflow + verdict + event feed**: untouched. Below the fold, animates during a live run.

### 6.2 Empty state

First load (no A2A calls yet):
- Service Earnings: *"0 verdicts sold yet — run the buyer script in a terminal to populate."* with the example command pre-filled and copy-to-clipboard.
- Cache Inventory: *"Empty — first Fresh call will populate."*

### 6.3 New dashboard data sources

| Endpoint | Polling | Component |
|---|---|---|
| `GET /agent/wallet` | on mount + on each `payment.settled` | header chip |
| `GET /service/activity` | every 2 s while page focused | Service Earnings panel |
| `GET /service/cache` | every 5 s while page focused | Cache Inventory panel |

## 7. Demo arc (5 minutes)

| Time | Action | What audience sees |
|---|---|---|
| 0:00 – 0:30 | Open dashboard | Empty operator console with primer text |
| 0:30 – 2:00 | Terminal: `node scripts/buy-verdict.mjs --tier fresh --address 0xc1f...` | 402 → sign → resend → 200; dashboard activity row fades in; cache inventory grows by one |
| 2:00 – 2:45 | Same command, `--tier cached` | Buyer pays $0.05, gets verdict near-instantly. *"10× cheaper because RugSleuth didn't spend on Apify this time."* |
| 2:45 – 4:00 | Click **Live run** in the operator panel | Workflow canvas lights up — three tool calls, three settled payments to Apify, agent autonomously decides "I have enough"; verdict card fills in |
| 4:00 – 4:45 | Pop wallet chip in header | Balance ticked down by $0.30 (Apify spend) and up by $0.55 (two A2A sales). Net positive on a $0.30 service. *"This is what an autonomous on-chain micro-service economy looks like."* |
| 4:45 – 5:00 | Close | *"x402 turned a CLI tool into a self-funding service in <1KLOC."* |

## 8. Build sequencing

**Day 1 (critical path)**
- Submit `deployer-fetched` and `holders-fetched` PPE events to Apify for pricing approval (this is the unknown-duration item — start it immediately).
- Add the new tool implementations in the `basescan-deep` actor (route handlers + Apify-charge calls).

**Day 1–2 (parallel, independent of Apify)**
- Add `/verdicts/fresh` and `/verdicts/cached` endpoints to the orchestrator.
- Implement the verdict cache (in-memory, 1 h TTL).
- Implement the activity log ring buffer + `/service/activity` and `/service/cache` endpoints.
- Hook up Coinbase x402 facilitator for inbound payments.
- Write `scripts/buy-verdict.mjs`.

**Day 2 (parallel)**
- Dashboard rebuild: header chip, Service Earnings panel, Tool Catalog, Cache Inventory.
- Demote address input to operator/dev row.
- Polling for `/service/activity` and `/service/cache`.

**Day 3 (when Apify approves)**
- Add the two new MCP tools (`scrape_basescan_deployer`, `scrape_basescan_holders`) — wires up to the already-implemented actor handlers.
- Update orchestrator system prompt to declare all three tools and the budget heuristic.
- End-to-end test: live run, three tool calls, verdict, then A2A buyer call hits the cache.

**Day 3–4 (polish)**
- SSE bridge on `/verdicts/fresh` (optional; only if there's time).
- Spend a session refining demo pacing.
- Pre-warm cache with 2–3 known addresses before the live demo.

## 9. Out of scope (explicit)

- Persistent storage. In-memory only. State lost on restart. Acceptable for a hackathon demo.
- Authentication beyond x402. Anyone with USDC can call `/verdicts/*`.
- Rate limiting. The orchestrator's investigation budget is the only spend cap.
- Apify-prepaid-x402 balance display (would require Apify API auth).
- Marketplace listing. RugSleuth's URL is shared manually with the demo audience.
- Multi-chain. Base only.
- A second Codex instance as the buyer agent. CLI script is the chosen representation.
- Custom facilitator. We use the Coinbase one.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Apify pricing approval slips | Inside-out sequencing — A2A + UI work proceeds against existing one-tool path. If approval misses demo day, the multi-tool narrative is replaced by "we ship the existing tool plus A2A" — still a winning story |
| Coinbase facilitator quirks (rare) | Pre-warm a verdict before the demo so the cached path is always demoable; have the recorded fallback video ready |
| Codex agent's verdict JSON drifts from spec | Defensive parsing already in place (`tryParseVerdict` clamps + defaults); add 2-3 example verdict outputs to the system prompt to anchor it |
| Cache miss right when the demo wants a cached call | Pre-populate cache with the demo address before going on stage |
| Buyer script fails mid-demo | Pre-run it once 5 minutes before the demo to warm caches and verify wallet balance |

## 11. Success criteria

The submission is done when:

- A judge can `curl` (or run our CLI script) against the live RugSleuth URL and receive a structured verdict in exchange for $0.50 USDC, with no Apify account on the buyer side.
- The same address called within 1 hour returns a verdict for $0.05 USDC.
- The dashboard, viewed by the judge during the demo, shows the buyer call appearing in the Service Earnings panel within ~1 second.
- A "Live run" from the dashboard triggers ≥ 2 settled Apify payments and produces a verdict.
- The mcpc wallet chip in the header reflects both spend and earnings during the demo.
- Total demo runs cost less than $5 of Apify spend across rehearsal + live demo.
