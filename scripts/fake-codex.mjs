#!/usr/bin/env node
// Pretends to be Codex: connects to rugcheck-mcp via stdio, calls one tool,
// then exits. Used by the mock e2e test.
import { spawn } from 'node:child_process';

if (process.argv[2] === 'mcp') {
  process.exit(0);
}

console.log('plan: scrape_basescan_address scrape_x_mentions list_deployer_contracts check_scam_blacklists analyze_wallet_cluster');
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
  send({
    method: 'tools/call',
    params: {
      name: 'scrape_x_mentions',
      arguments: { address: '0xc1fcc4300305a415a7ea894f71a0694e9f7831d3' },
    },
  });
}, 800);

setTimeout(() => {
  send({
    method: 'tools/call',
    params: {
      name: 'list_deployer_contracts',
      arguments: { address: '0xc1fcc4300305a415a7ea894f71a0694e9f7831d3' },
    },
  });
}, 1_400);

setTimeout(() => {
  send({
    method: 'tools/call',
    params: {
      name: 'check_scam_blacklists',
      arguments: { address: '0xc1fcc4300305a415a7ea894f71a0694e9f7831d3' },
    },
  });
}, 2_000);

setTimeout(() => {
  send({
    method: 'tools/call',
    params: {
      name: 'analyze_wallet_cluster',
      arguments: { address: '0xc1fcc4300305a415a7ea894f71a0694e9f7831d3' },
    },
  });
}, 2_600);

setTimeout(() => {
  const verdict = {
    score: 78,
    label: 'SUSPICIOUS',
    confidence: 'medium',
    reasons: [
      'Contract source is unverified.',
      'Sparse on-chain history for the address.',
    ],
    evidence: [
      { source: 'BaseScan', finding: 'Unverified contract on a fresh address', costUsdc: '0.05' },
    ],
    durationSec: 4,
  };
  console.log(`VERDICT: ${JSON.stringify(verdict)}`);
  mcp.kill();
  process.exit(0);
}, 5_000);
