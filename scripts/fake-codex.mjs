#!/usr/bin/env node
// Pretends to be Codex: connects to rugcheck-mcp via stdio, calls one tool,
// then exits. Used by the mock e2e test.
import { spawn } from 'node:child_process';

console.log('plan: scrape_basescan_address');
const mcp = spawn('node', ['services/rugcheck-mcp/dist/index.js'], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let id = 0;
function send(msg) {
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: ++id, ...msg }) + '\n');
}

mcp.stdout.on('data', (c) => process.stdout.write(c)); // surface MCP responses

setTimeout(() => {
  send({
    method: 'tools/call',
    params: {
      name: 'scrape_basescan_address',
      arguments: { address: '0xc1fcc4300305a415a7ea894f71a0694e9f7831d3' },
    },
  });
}, 200);

setTimeout(() => {
  console.log('verdict: done');
  mcp.kill();
  process.exit(0);
}, 5_000);
