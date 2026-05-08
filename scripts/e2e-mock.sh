#!/usr/bin/env bash
set -euo pipefail

# Boot the orchestrator with a fake codex that calls scrape_basescan_address
# once via the rugcheck-mcp server, with a mock x402 server in the loop.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 1. Start a mock x402 server in the background (uses the test fixture).
npx tsx -e '
import("./packages/x402-client/test/mock-server.ts").then(async (mod) => {
  const m = await mod.startMockServer({});
  console.log(JSON.stringify({ url: m.url }));
  process.stdin.resume();
});' > /tmp/rs-mock.log &
MOCK_PID=$!
# tsx has more cold-start overhead than plain node, so wait until the mock
# server has logged its URL before reading it.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if [ -s /tmp/rs-mock.log ]; then break; fi
  sleep 1
done
MOCK_URL="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("/tmp/rs-mock.log","utf8")).url)')"

# 2. Build everything.
npm --workspace packages/x402-client run build
npm --workspace services/rugcheck-mcp run build
npm --workspace services/orchestrator run build

# 3. Start orchestrator with a fake codex.
CODEX_BIN="$(node -e 'console.log(require.resolve("./scripts/fake-codex.mjs"))')" \
WALLET_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
APIFY_BASE_URL="$MOCK_URL" \
BASESCAN_DEEP_ACTOR_ID=team/basescan-deep \
OPENAI_API_KEY=sk-test \
ORCHESTRATOR_PORT=4000 \
node services/orchestrator/dist/index.js &
ORCH_PID=$!

cleanup() { kill "$ORCH_PID" "$MOCK_PID" 2>/dev/null || true; }
trap cleanup EXIT
sleep 1

# 4. Drive an investigation and stream events.
ID="$(curl -s -X POST http://localhost:4000/investigations \
  -H 'content-type: application/json' \
  -d '{"address":"0xc1fcc4300305a415a7ea894f71a0694e9f7831d3"}' | jq -r .id)"
echo "Investigation: $ID"
curl -N "http://localhost:4000/investigations/$ID/events"
