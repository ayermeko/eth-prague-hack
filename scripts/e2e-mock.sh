#!/usr/bin/env bash
set -euo pipefail

# Boot the orchestrator with a fake codex that calls scrape_basescan_address
# once via the rugcheck-mcp server, with a mock x402 server in the loop.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ORCHESTRATOR_PORT="$(node -e '
const server = require("net").createServer();
server.listen(0, "127.0.0.1", () => {
  console.log(server.address().port);
  server.close();
});
')"

# 1. Start a mock x402 server in the background (uses the test fixture).
rm -f /tmp/rs-mock.log
npx tsx -e '
import("./packages/x402-client/test/mock-server.ts").then(async (mod) => {
  const m = await mod.startMockServer({
    resultBody: [{
      address: "0xc1fcc4300305a415a7ea894f71a0694e9f7831d3",
      ethBalance: "0.01 ETH",
      isContract: true,
      verified: false,
      latestTxs: ["mock-tx-1", "mock-tx-2"],
      scrapedAt: "2026-05-08T12:00:00.000Z"
    }]
  });
  console.log(JSON.stringify({ url: m.url }));
  process.stdin.resume();
});' > /tmp/rs-mock.log &
MOCK_PID=$!
# tsx has more cold-start overhead than plain node, so wait until the mock
# server has logged its URL before reading it.
for _ in $(seq 1 30); do
  if [ -s /tmp/rs-mock.log ]; then break; fi
  sleep 1
done
MOCK_URL="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("/tmp/rs-mock.log","utf8")).url)')"

# 2. Build everything.
npm --workspace packages/x402-client run build
npm --workspace services/rugcheck-mcp run build
npm --workspace services/orchestrator run build

# 3. Start orchestrator with a fake codex. Inline env vars override .env.local
# (dotenv only sets vars that aren't already in process.env), so we force
# x402 mode + mock URL regardless of what the developer has configured for
# real runs.
CODEX_BIN="$(node -e 'console.log(require.resolve("./scripts/fake-codex.mjs"))')" \
APIFY_PAYMENT_MODE=x402 \
WALLET_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
APIFY_BASE_URL="$MOCK_URL" \
BASESCAN_DEEP_ACTOR_ID=team/basescan-deep \
APIFY_TOKEN= \
OPENAI_API_KEY=sk-test \
ORCHESTRATOR_PORT="$ORCHESTRATOR_PORT" \
node services/orchestrator/dist/index.js &
ORCH_PID=$!

cleanup() { kill "$ORCH_PID" "$MOCK_PID" 2>/dev/null || true; }
trap cleanup EXIT
for _ in $(seq 1 30); do
  if curl -fsS "http://localhost:$ORCHESTRATOR_PORT/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$ORCH_PID" 2>/dev/null; then
    echo "orchestrator exited before health check passed" >&2
    wait "$ORCH_PID"
  fi
  sleep 1
done
curl -fsS "http://localhost:$ORCHESTRATOR_PORT/health" >/dev/null

# 4. Drive an investigation and stream events.
ID="$(curl -s -X POST "http://localhost:$ORCHESTRATOR_PORT/investigations" \
  -H 'content-type: application/json' \
  -d '{"address":"0xc1fcc4300305a415a7ea894f71a0694e9f7831d3"}' | jq -r .id)"
echo "Investigation: $ID"
EVENTS_FILE="$(mktemp)"
set +e
curl --no-progress-meter --max-time 12 -N "http://localhost:$ORCHESTRATOR_PORT/investigations/$ID/events" | tee "$EVENTS_FILE"
CURL_STATUS=${PIPESTATUS[0]}
set -e

if [ "$CURL_STATUS" -ne 0 ] && [ "$CURL_STATUS" -ne 28 ]; then
  echo "event stream failed with curl status $CURL_STATUS" >&2
  exit "$CURL_STATUS"
fi

grep -q '"type":"mcp.event".*"status":"settled"' "$EVENTS_FILE"
grep -q '"type":"verdict.rendered"' "$EVENTS_FILE"
grep -q '"type":"investigation.completed".*"reason":"verdict"' "$EVENTS_FILE"
