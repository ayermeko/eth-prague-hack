---
marp: true
theme: default
paginate: true
backgroundColor: "#0b0b0d"
color: "#e7e7ea"
style: |
  section { font-family: ui-monospace, SF Mono, Menlo, monospace; font-size: 26px; padding: 60px; }
  h1 { color: #34d399; font-size: 56px; margin-bottom: 8px; }
  h2 { color: #34d399; font-size: 40px; }
  h3 { color: #fbbf24; font-size: 28px; }
  strong { color: #fbbf24; }
  code { color: #fbbf24; background: #18181b; padding: 2px 6px; border-radius: 4px; }
  pre { background: #18181b; padding: 16px; border-radius: 6px; font-size: 18px; }
  blockquote { border-left: 4px solid #34d399; color: #a1a1aa; padding-left: 16px; }
  table { font-size: 22px; }
  td, th { padding: 8px 14px; }
---

# RugSleuth

### An autonomous onchain investigator that pays for its own intel.

**ETH Prague 2026 · Apify x402 bounty**

---

## The problem

A new memecoin appears on Base. You've got 5 minutes before the price moves.

You'd need to:

- Open BaseScan, check the deployer's other contracts
- Eyeball Dexscreener for LP, holders, snipers
- Scroll the project's Twitter, judge if the followers are real
- Stitch it all into a verdict

A careful trader spends **5–15 minutes**.
A casual trader skips it and **gets rugged**.

---

## The solution

Paste a contract address. Walk away. **90 seconds and $1.50 later** an autonomous agent comes back with a verdict.

```
$ Investigate 0xABC… on Base.   Budget: $2.00 USDC.
  💸 0.05 USDC → basescan-deep · address-fetched   settled
  💸 0.05 USDC → basescan-deep · deployer-history   settled
  💸 0.30 USDC → twitter-scraper · profile           settled
  💸 0.10 USDC → dexscreener · pair                  settled

  VERDICT  ·  92% LIKELY RUG  ·  spent $0.50 / $2.00 · 71s
  • Deployer launched 14 tokens in 30 days
  • LP not locked
  • Twitter account 4 hours old
```

---

## How it works

```
  Browser  ─┐
            │  Next.js dashboard  (live SSE stream)
            ▼
  Orchestrator   ──spawn──▶  Codex CLI  (GPT-5 agent)
   (Fastify, SSE)                │
            ▲                    │ MCP tools
            │                    ▼
            │            rugcheck-mcp  (custom MCP server)
            │                    │
            │                    ▼
            │            x402-client   (viem · EIP-712)
            │                    │
            └──── Base mainnet ──┘
                  USDC settlement
```

The agent **owns its own wallet** and decides what to spend on. That's the bounty's archetype.

---

## Why x402 makes this real

| Without x402 | With x402 |
|---|---|
| Agent needs an Apify account | Agent has a **wallet**, no account |
| Human signs every API call | Agent signs **EIP-712** automatically |
| API key sits in env vars | Money sits in USDC, **budget-capped** |
| Can't run unsupervised | **Genuinely autonomous** |

x402 turns paid services into HTTP endpoints any agent with a wallet can hit. We're showing the *agentic* archetype the protocol was built for.

---

## What we built — live

**Six commits in 48 hours.**

- **`@rugsleuth/x402-client`** — TS client implementing x402 from scratch with viem. EIP-712 typed signing, prepaid drawdown, payment-event stream. **4/4 tests.**
- **`basescan-deep` Actor** — PPE-priced ($0.05/event) scraper, deployed on Apify.
- **`@rugsleuth/rugcheck-mcp`** — MCP server exposing the paid scraper as a Codex tool. Stderr-tagged event log so the orchestrator sees every payment.
- **`@rugsleuth/orchestrator`** — Fastify + SSE. Spawns Codex per investigation, **enforces the USDC budget cap**, kills the run on overspend. **5/5 tests.**
- **Dashboard** — Next.js. Codex transcript on the left, x402 payments on the right, verdict at the bottom.

---

## Mock e2e — already proven

```
$ ./scripts/e2e-mock.sh

data: { type: codex.line, line: "plan: scrape_basescan_address" }
data: { type: mcp.event, payload: { kind: payment, status: required,  amountUsdc: "0.05" } }
data: { type: mcp.event, payload: { kind: payment, status: signed,    amountUsdc: "0.05" } }
data: { type: mcp.event, payload: { kind: payment, status: settled,   amountUsdc: "0.05" } }
data: { type: mcp.event, payload: { kind: tool.end, ok: true } }
data: { type: codex.line, line: "verdict: done" }
data: { type: investigation.completed, reason: "verdict" }
```

Full payment lifecycle visible end-to-end. The live demo just swaps the mock for real Apify + Base.

---

## How we score the bounty

| Criterion | Where we land |
|---|---|
| **Relevance** | Rug detection is a real, painful Web3 problem. The investigator pattern generalises to DeFi due diligence, OTC, governance. |
| **Functionality** | Every scrape is a *visible* x402 micropayment. The agent literally cannot work without paying. Demo proves the protocol end-to-end. |
| **Creativity** | The agent **owns its wallet** and **decides what to spend on**. Codex as the harness, custom MCP as the bridge, viem-signed EIP-712 — exactly the archetype x402 was designed for. |

---

## What's next

- **More signals** — Twitter, Dexscreener, Telegram all over PPE-priced Apify Actors.
- **Verdict rubric** — explainable score, not a black box.
- **Sleuth-as-a-service** — open the agent's endpoint; users pay USDC to query. *Agents calling agents.*

---

## RugSleuth

**Repo:** github.com/ayermeko/eth-prague-hack
**Branch:** `jstudnic`
**Demo:** localhost — let's run it.

> *An agent investigates. An agent pays. The protocol just works.*

**Thank you.**
