# Credits-First Live Vertical Slice Design

## Context

RugSleuth is an ETH Prague Apify bounty project. The final bounty demo must integrate Apify through x402 and show a real, tangible use case of autonomous agent payments. The current repo already contains the core architecture: dashboard, orchestrator, Codex subprocess runner, rugcheck MCP server, x402 client, and a BaseScan Apify Actor.

The next practical milestone is to make the project live with real Apify data before spending real USDC. We will use an Apify API token and the user's Apify credits first, then reuse the same runtime path for x402.

Secrets must stay local. Apify tokens and wallet private keys are never committed, printed in logs, or added to documentation.

## Goals

- Run a real end-to-end investigation from the dashboard using the user's Apify Actor.
- Support `APIFY_PAYMENT_MODE=token` for real Actor runs paid by Apify credits.
- Keep `APIFY_PAYMENT_MODE=x402` as the final bounty payment mode.
- Preserve the same Codex -> MCP -> Apify flow in both modes so token mode is not a separate fake demo.
- Stream enough events to prove the system is live: tool start, Actor call, credit-backed result, Codex transcript, completion.

## Non-Goals

- Do not add Dexscreener or social scraping yet.
- Do not require a wallet private key for token mode.
- Do not persist investigations in a database.
- Do not deploy cloud infrastructure in this slice.

## Architecture

The orchestrator starts Codex with a fixed RugSleuth prompt. Codex uses the `rugsleuth` MCP server. The MCP server exposes `scrape_basescan_address` and chooses its Apify access method from `APIFY_PAYMENT_MODE`.

In token mode, the MCP tool calls:

`POST https://api.apify.com/v2/acts/{actorId}/run-sync-get-dataset-items?token={APIFY_TOKEN}`

In x402 mode, the existing x402 client path remains responsible for the 402 challenge, signature, resend, and payment events.

The dashboard receives SSE events from the orchestrator. It should show real tool activity and a final completion state. It may keep the existing demo playback button, but the default path should be the live investigation.

## Configuration

Required for token mode:

```env
APIFY_PAYMENT_MODE=token
APIFY_TOKEN=...
BASESCAN_DEEP_ACTOR_ID=...
APIFY_BASE_URL=https://api.apify.com
ORCHESTRATOR_PORT=4000
NEXT_PUBLIC_ORCHESTRATOR_URL=http://localhost:4000
INVESTIGATION_BUDGET_USDC=2.00
INVESTIGATION_TIMEOUT_MS=180000
```

Required later for x402 mode:

```env
APIFY_PAYMENT_MODE=x402
WALLET_PRIVATE_KEY=0x...
BASESCAN_DEEP_ACTOR_ID=...
```

## Data Flow

1. User enters a Base address in the dashboard.
2. Dashboard posts the address to `POST /investigations`.
3. Orchestrator validates the address and spawns Codex.
4. Codex calls `mcp__rugsleuth__scrape_basescan_address`.
5. MCP calls the Apify Actor with the configured payment mode.
6. MCP emits structured `RSEVT` lines to stderr.
7. Orchestrator parses `RSEVT` lines and forwards them to the dashboard over SSE.
8. Codex prints a `VERDICT:` line and exits.
9. Orchestrator emits `investigation.completed`.

## Error Handling

- Missing `APIFY_TOKEN` fails startup only when `APIFY_PAYMENT_MODE=token`.
- Missing `WALLET_PRIVATE_KEY` fails startup only when `APIFY_PAYMENT_MODE=x402`.
- Actor failures return a structured MCP error and emit `tool.end` with `ok: false`.
- Non-JSON Actor responses are surfaced with HTTP status and a short body preview.
- The orchestrator timeout remains the hard stop for runaway Codex runs.

## Testing

- Unit test the token-mode Apify provider with a mocked fetch implementation.
- Unit test environment parsing for token and x402 modes.
- Unit test that `scrape_basescan_address` emits an `apify.call` or equivalent event in token mode.
- Run existing workspace tests.
- Smoke test locally with the user's real `.env.local` after secrets are configured.

## Approval

This spec defines the credits-first live vertical slice. The following implementation plan turns it into small, testable changes.
