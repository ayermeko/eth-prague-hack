# RugSleuth — Possible Features

> *Strategic feature brainstorm for the ETH Prague 2026 Apify x402 bounty.*
> Audience: the team. Goal: align on **what makes RugSleuth unforgettable to judges** and which features ship before the demo.

---

## 1. The edge — what we are *actually* building

We are not building a rug detector. The market is full of those (GoPlus, Honeypot.is, TokenSniffer). If our pitch is *"AI rug detector with a fancy UI"*, we lose to whoever has more training data. **That is not the edge.**

Four things actually make RugSleuth distinctive. Every feature decision should reinforce one of these.

### 1.1 It's an *economic agent*, not a tool

Every existing rug detector runs on pre-paid SaaS infrastructure — they brute-force everything because compute is "free". RugSleuth has $2 per investigation and **must reason about which evidence is worth buying**. That's not a feature, it's a different paradigm. A SaaS cannot replicate it no matter how clever its rubric, because it has no incentive to be selective. The agent's *budget pressure* is what makes it think like a human investigator instead of a brute-force scanner.

### 1.2 The dossier comes with cryptographic receipts

Every claim in the verdict can be traced to a specific x402 payment hash → a specific Apify actor → a specific raw response. For a risk analyst, this is not "a report from a service we trust" — it's a **forensic artifact she can replay weeks later and re-verify**. For governance, lending, insurance, this changes the conversation from "AI says rug" to *"here's the chain-of-custody for every claim"*. Nobody else in this bounty pool will have this.

### 1.3 The intel layer is open

Someone publishes a new PPE actor tomorrow — `etherscan-internal-tx-tracer`, `github-rug-pattern-matcher`, `telegram-deleted-message-archive` — and **RugSleuth can find it, pay it, and start using it with zero integration work**. Coverage compounds passively as the Apify ecosystem grows. Competitors need a BD team. We don't.

### 1.4 The "spectacle" is uniquely demoable

The thing that makes audiences lean in is not "92% rug" — it's watching the agent visibly trade off cost vs information value in real time. *"I won't buy holder distribution because the deployer signal is already conclusive."* No other AI demo lets you see the agent reason about its own compute cost. Every other AI demo hides it.

### 1.5 What is *not* the edge (do not build around these)

- The rug heuristics — commodity
- The LLM — commodity
- The dashboard styling — commodity
- "It's an AI agent" — table stakes in 2026

---

## 2. The bounty's hidden criterion

The judging criteria are explicit: **relevance, functionality, creativity**. The implicit fourth is *"did this demo work and do I remember it 4 hours later?"* Judges watch ~20 demos that day. The winner isn't the most technically impressive — it's the most **unforgettable** one that also functioned without stuttering.

The bounty text gives away the strategy: it names *"an agent paying another agent"* as the canonical archetype. Our current design has an agent paying *Apify actors* (which are programs, not agents). **No team will hit that exact phrase as literally as we can if we build agent-to-agent payment.**

---

## 3. Three directions, with trade-offs

Each is implementable in roughly one day on top of what already exists.

### Direction A — Agent-to-agent (hit the bounty's literal words)

Add a second agent — call it **Counsel** — running on its own MCP with its own wallet. After RugSleuth has a preliminary verdict, it *pays Counsel* for a second-opinion audit. Counsel is itself autonomous: it spends some of what it earned to fact-check one of RugSleuth's claims (e.g., re-fetches the deployer history from a different actor). Two wallets visible on screen, x402 flowing both directions.

| Pros | Cons |
|---|---|
| Maxes out creativity score | Two agents = double the failure surface |
| Nails bounty wording exactly | Story is more abstract |
| Visually unique (split-screen, two tickers) | Needs an honest second-opinion rubric or it feels staged |

### Direction B — Make the economic reasoning the show

Three UI additions, all theater:

1. **Giant animated wallet ticker** — top of screen, $5.23 → $5.18 → $5.08 with each payment, slot-machine animation. Most demos hide cost. We make it the centerpiece.
2. **"Skipped tools" panel** — at the end, show every tool the agent *decided not to call* and why. *"Saved $0.40 — deployer signal already conclusive, holder distribution wouldn't change verdict."* This makes the budget-aware paradigm visible — nobody else in the bounty pool will have this.
3. **SaaS-vs-Sleuth panel** — same contract run through GoPlus (free SaaS). Show its verdict next to RugSleuth's *with payment receipts*. The contrast is the pitch.

| Pros | Cons |
|---|---|
| Lowest demo-failure risk (UI on top of working backend) | Doesn't hit "agent paying agent" wording directly |
| Sells the paradigm shift in one glance | Could read as "polish" rather than innovation |
| Every screenshot becomes shareable | — |

### Direction C — Live judge interaction

Two additions:

1. **"Judge picks the contract"** — empty demo run where someone in the audience pastes a contract address. Agent has to handle it cold.
2. **On-chain verification on stage** — verdict comes with a downloadable JSON. Judges scan a QR, see all payment hashes, click through to Basescan. *"If this is fake, prove it from your phone right now."*

| Pros | Cons |
|---|---|
| Maximum trust signal | Highest demo-failure risk — agent fails on judge's pick → demo dies |
| Memorable | Relies on judges willingly scanning a QR |
| Forces robustness which is its own demo | — |

---

## 4. Recommended combo: **B-spine + surgical A**

Reasoning:

- **B alone wins on functionality** — it's mostly UI on top of a backend that already works. Low risk.
- **B wins the "paradigm shift" narrative** — and the paradigm IS our edge.
- B alone leaves "creativity" points on the table because it doesn't hit the bounty's literal phrase.
- **Solution:** in the final 30 seconds of the demo, RugSleuth pays a *minimal* second agent — a **Verifier** that publishes the dossier hash to a public registry and signs an audit attestation. One x402 transaction, agent-to-agent, end of demo. Closes the loop on "agent paying another agent" **without** the cost of building and debugging a full Counsel agent.
- **Skip C entirely** — judges might love the live-pick mode, but the failure cost is total demo death. Too much downside.

---

## 5. The killer feature shortlist

Five features. Each is ~half a day of work. Together they are the most theatrical, lowest-risk demo we can ship.

### F1 — Animated wallet ticker

**What:** Prominent top-of-screen counter showing current USDC balance. Each `payment.settled` event triggers a slot-machine animation. Color flashes amber → settled green.

**Why it's killer:** Audiences haven't seen an AI demo where the cost is *the show*. Every screenshot becomes a shareable artifact ("look how cheap this is").

**Files touched:** `apps/dashboard/components/WalletTicker.tsx` (new), `app/page.tsx` (mount it).

**Effort:** 0.5 day. Pure UI.

**Edge reinforced:** §1.1 (economic agent), §1.4 (spectacle).

---

### F2 — "Skipped tools" reasoning panel

**What:** After the verdict, render a panel listing every tool the agent considered but did not call, with the agent's stated reason. Source: a new MCP "decision log" event the agent emits when it decides *not* to call a tool. Codex prompt is amended to instruct the agent to log skipped-tool decisions before issuing a verdict.

**Why it's killer:** Makes the budget-aware paradigm *visible*. This is the single feature that no SaaS competitor and no other bounty submission can copy without rebuilding their whole architecture. It sells the edge in one panel.

**Files touched:** `services/orchestrator/src/index.ts` (system prompt), `services/rugcheck-mcp/src/tools/*` (new `log_decision` tool), `apps/dashboard/components/SkippedToolsPanel.tsx` (new).

**Effort:** 1 day. Modest backend, simple UI.

**Edge reinforced:** §1.1 (economic agent — the budget reasoning IS the differentiator).

---

### F3 — SaaS-vs-Sleuth comparison panel

**What:** Run the same contract through a free SaaS (GoPlus token security API — no auth required for basic checks) at investigation start. Render its raw verdict alongside RugSleuth's, with a big "vs" divider. Their answer is opaque. Ours has receipts.

**Why it's killer:** Side-by-side demolishes the "AI rug detector" framing instantly. The pitch lands without us having to explain it. Audience does the comparison work for us.

**Files touched:** `services/orchestrator/src/baseline.ts` (new — calls GoPlus), `apps/dashboard/components/ComparisonPanel.tsx` (new).

**Effort:** 0.5 day. GoPlus has a free public endpoint, single fetch.

**Edge reinforced:** §1.2 (receipts vs opaque output).

**Risk:** GoPlus rate-limits or goes down during demo. Mitigation: cache one comparison run per demo target.

---

### F4 — Verifier handshake (agent-to-agent payment)

**What:** A minimal second agent — `verifier-mcp` — exposing one tool: `attest_dossier(hash, claims[])`. It runs as a separate MCP server with its own wallet. RugSleuth's final action, after `render_verdict`, is to pay Verifier ~$0.10 USDC to:

1. Recompute the dossier hash from the evidence trail.
2. Sample one claim at random and re-fetch its source data via x402 (Verifier pays Apify directly).
3. Sign an EIP-191 attestation: `(dossierHash, verifierSignature, timestamp)`.

The attestation appears as a green stamp on the verdict card. The Verifier wallet's balance ticker (small, bottom-right) shows USDC flowing *in* from RugSleuth and *out* to Apify.

**Why it's killer:** This is the bounty's literal archetype — *agent paying another agent*. One transaction, 30 seconds of demo time, closes the loop. We do not need to build a full Counsel agent with its own LLM loop; Verifier's logic is deterministic.

**Files touched:** `services/verifier-mcp/` (new package, ~150 LOC), `services/rugcheck-mcp/src/tools/request_attestation.ts` (new), wallet config for second account.

**Effort:** 1 day. Most of the time goes to wallet plumbing for the second account, not logic.

**Edge reinforced:** §1.2 (cryptographic receipts), bounty wording ("agent paying another agent").

**Risk:** Two wallets to fund and manage. Mitigation: second wallet only needs ~$1 USDC; no need for sophistication.

---

### F5 — Verifiable dossier export

**What:** "Download dossier" button on the verdict card. Produces a single JSON file containing:
- Verdict (score, label, reasons)
- Every evidence item with the actor that produced it
- Every payment event (status, amount, on-chain tx hash if applicable, prepaid balance reference otherwise)
- Verifier attestation from F4 (if F4 ships)
- Codex transcript hash

**Why it's killer:** Cheapest possible feature with the biggest trust signal. We hand judges a file. They can paste any payment hash into Basescan and verify it themselves. *"This isn't a mockup."*

**Files touched:** `services/orchestrator/src/dossier.ts` (new), `apps/dashboard/components/VerdictCard.tsx` (download button).

**Effort:** 0.5 day. The orchestrator already has all this data; just serialize it.

**Edge reinforced:** §1.2 (receipts).

---

## 6. Effort summary

| # | Feature | Effort | Risk | Edge reinforced |
|---|---|---|---|---|
| F1 | Animated wallet ticker | 0.5 d | Low | Spectacle |
| F2 | Skipped-tools panel | 1.0 d | Low | Paradigm |
| F3 | SaaS-vs-Sleuth comparison | 0.5 d | Medium (external dep) | Receipts framing |
| F4 | Verifier handshake | 1.0 d | Medium (2nd wallet) | Receipts + bounty wording |
| F5 | Verifiable dossier export | 0.5 d | Low | Receipts |
| **Total** | | **3.5 d** | | All four edges covered |

For a 3-person team across the remaining hackathon hours, this is doable. If we're forced to cut, the cut order is: **F3 → F1 → F4**. We never cut F2 (the paradigm) or F5 (the trust signal).

---

## 7. Out of scope (post-hackathon)

Captured here so we don't re-debate them mid-demo-prep:

- **Sleuth-as-a-stream** — subscribe to all new Base deployments, agent pre-screens them, posts to Telegram/Discord. Strong post-hackathon product but invisible in a 5-min demo.
- **Multi-agent swarm with debate** — 3 cheap agents (skeptic / optimist / neutral) arguing in chat. Spectacular but high failure surface; not worth the risk for the bounty.
- **Cross-investigation memory** — agent remembers serial deployers across runs, future investigations get cheaper. Compelling product feature, demo-invisible.
- **Reputation chain** — RugSleuth's verdicts go on-chain, build a track record, future agents pay RugSleuth itself. Big idea, post-hackathon.
- **Counterfactual investigation** — "what if this evidence didn't exist?" replay. Cool but not load-bearing.
- **Pay-to-prioritize** — power users deposit USDC to push their contracts to the front. Monetization, not demo.

These are real ideas worth keeping. They are not what we ship before judging.

---

## 8. Demo script (target, given F1–F5 ship)

| Time | Action | Feature on screen |
|---|---|---|
| 0:00 | Slide: bounty + problem (one paragraph each) | — |
| 0:30 | Open dashboard. Wallet ticker shows $5.23. Paste rug contract. | F1 |
| 0:35 | Comparison panel renders GoPlus's opaque verdict instantly | F3 |
| 0:45 | Click Investigate. Codex transcript starts. Wallet ticker drops on first payment. | F1 + existing |
| 1:30 | Audience watches multiple x402 payments accrue, evidence cards appear | existing |
| 2:30 | Verdict card: 92% rug, with reasons. Verifier handshake fires; green attestation stamp appears. | F4 |
| 2:45 | Reveal "Skipped tools" panel — agent saved $0.40 by reasoning about evidence value | F2 |
| 3:00 | Click "Download dossier". Open the JSON. Paste a payment hash into Basescan live. | F5 |
| 3:30 | Re-run on the legit contract. Different reasoning, low score. | existing |
| 4:30 | Architecture slide: ~30s on x402 + Codex + MCP + agent-to-agent | — |
| 5:00 | End. | — |

---

## 9. Open questions for the team

| # | Question | Owner | Decision needed by |
|---|---|---|---|
| Q1 | Are we OK funding a second wallet (~$1 USDC) for the Verifier agent? | Lead | Day 2 morning |
| Q2 | Does GoPlus's free endpoint cover Base contracts well enough for the comparison panel? Spike needed. | Eng B | Day 1 morning |
| Q3 | Final demo targets: which historical rug? Which legit token? Need Day-2 dry runs against both. | Lead | Day 2 |
| Q4 | If we have to cut one feature, do we drop F3 first or F1? F3 has external dependency risk. | All | Day 2 evening |
| Q5 | Wallet ticker — show actual address or anonymise? Address adds trust but length crowds the UI. | Lead | Day 2 |

---

*Maintainer: see `git log` · Last updated: 2026-05-09*
