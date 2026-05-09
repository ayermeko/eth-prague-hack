'use client';
import type { DashboardEvent } from './useInvestigation';

// Each step is an event plus a delay (ms) to wait *before* emitting it.
// Total wall time ≈ 32s — fast enough for a teammate to grok the flow,
// slow enough that the x402 required→signed→settled lifecycle is visible.
interface Step {
  delayMs: number;
  event: (now: () => string) => DashboardEvent;
}

const SUSPECT = '0xb4dc0ffee5c4mc01nf4ked1edc0dec4fefe4d666';
const DEPLOYER = '0xa11ce15a5er14ldeP10y3rofM4nyR0gPu115ff';
const ACTOR_BSCAN = 'jstudnic/basescan-deep';
const ACTOR_DEXS = 'apify/dexscreener';
const ACTOR_TWTR = 'apify/twitter-scraper';

export const MOCK_ADDRESS = SUSPECT;

export const MOCK_SCENARIO: Step[] = [
  // ── Plan ────────────────────────────────────────────────────────────────
  { delayMs: 200, event: (now) => ({
      type: 'codex.line',
      ts: now(),
      line: `[codex] thinking… target ${SUSPECT} on Base`,
    }),
  },
  { delayMs: 600, event: (now) => ({
      type: 'codex.line', ts: now(),
      line: '[codex] plan: cheapest signals first → basescan address → deployer history → LP & holders → social sanity check',
    }),
  },

  // ── Tool 1: basescan address ────────────────────────────────────────────
  { delayMs: 700, event: (now) => ({
      type: 'mcp.event', ts: now(),
      payload: { kind: 'tool.start', tool: 'scrape_basescan_address', args: { address: SUSPECT } },
    }),
  },
  { delayMs: 200, event: (now) => ({
      type: 'mcp.event', ts: now(),
      payload: {
        kind: 'payment', tool: ACTOR_BSCAN, status: 'required',
        amountUsdc: '0.0500', payTo: '0xApifyFacilitator…', ppeEvent: 'address-fetched',
      },
    }),
  },
  { delayMs: 1800, event: (now) => ({
      type: 'mcp.event', ts: now(),
      payload: {
        kind: 'payment', tool: ACTOR_BSCAN, status: 'signed',
        amountUsdc: '0.0500', payTo: '0xApifyFacilitator…', ppeEvent: 'address-fetched',
      },
    }),
  },
  { delayMs: 1100, event: (now) => ({
      type: 'mcp.event', ts: now(),
      payload: {
        kind: 'payment', tool: ACTOR_BSCAN, status: 'settled',
        amountUsdc: '0.0500', payTo: '0xApifyFacilitator…', ppeEvent: 'address-fetched',
      },
    }),
  },
  { delayMs: 1500, event: (now) => ({
      type: 'mcp.event', ts: now(),
      payload: { kind: 'tool.end', tool: 'scrape_basescan_address', ok: true, ms: 4400 },
    }),
  },
  { delayMs: 200, event: (now) => ({
      type: 'codex.line', ts: now(),
      line: '[codex] result: contract verified=false, source not published, age=2h13m, balance=0.04 ETH',
    }),
  },
  { delayMs: 500, event: (now) => ({
      type: 'codex.line', ts: now(),
      line: '[codex] suspicious: unverified + brand new. Check who deployed it.',
    }),
  },

  // ── Tool 2: deployer ────────────────────────────────────────────────────
  { delayMs: 600, event: (now) => ({
      type: 'mcp.event', ts: now(),
      payload: { kind: 'tool.start', tool: 'scrape_basescan_deployer', args: { address: SUSPECT } },
    }),
  },
  { delayMs: 200, event: (now) => ({
      type: 'mcp.event', ts: now(),
      payload: {
        kind: 'payment', tool: ACTOR_BSCAN, status: 'required',
        amountUsdc: '0.1000', payTo: '0xApifyFacilitator…', ppeEvent: 'deployer-fetched',
      },
    }),
  },
  // Prepaid balance from first payment — no signed event, settles instantly.
  { delayMs: 900, event: (now) => ({
      type: 'mcp.event', ts: now(),
      payload: {
        kind: 'payment', tool: ACTOR_BSCAN, status: 'settled',
        amountUsdc: '0.1000', payTo: '0xApifyFacilitator…', ppeEvent: 'deployer-fetched',
      },
    }),
  },
  { delayMs: 1700, event: (now) => ({
      type: 'mcp.event', ts: now(),
      payload: { kind: 'tool.end', tool: 'scrape_basescan_deployer', ok: true, ms: 2600 },
    }),
  },
  { delayMs: 200, event: (now) => ({
      type: 'codex.line', ts: now(),
      line: `[codex] result: deployer ${DEPLOYER} launched 14 contracts in last 30d, 11 already drained`,
    }),
  },
  { delayMs: 500, event: (now) => ({
      type: 'codex.line', ts: now(),
      line: '[codex] strong signal: serial-deployer pattern. Probability of rug rising. Confirming with LP state.',
    }),
  },

  // ── Tool 3: dexscreener ────────────────────────────────────────────────
  { delayMs: 600, event: (now) => ({
      type: 'mcp.event', ts: now(),
      payload: { kind: 'tool.start', tool: 'scrape_dexscreener_pair', args: { address: SUSPECT } },
    }),
  },
  { delayMs: 200, event: (now) => ({
      type: 'mcp.event', ts: now(),
      payload: {
        kind: 'payment', tool: ACTOR_DEXS, status: 'required',
        amountUsdc: '0.2000', payTo: '0xApifyFacilitator…', ppeEvent: 'pair-fetched',
      },
    }),
  },
  { delayMs: 1800, event: (now) => ({
      type: 'mcp.event', ts: now(),
      payload: {
        kind: 'payment', tool: ACTOR_DEXS, status: 'signed',
        amountUsdc: '0.2000', payTo: '0xApifyFacilitator…', ppeEvent: 'pair-fetched',
      },
    }),
  },
  { delayMs: 1100, event: (now) => ({
      type: 'mcp.event', ts: now(),
      payload: {
        kind: 'payment', tool: ACTOR_DEXS, status: 'settled',
        amountUsdc: '0.2000', payTo: '0xApifyFacilitator…', ppeEvent: 'pair-fetched',
      },
    }),
  },
  { delayMs: 1300, event: (now) => ({
      type: 'mcp.event', ts: now(),
      payload: { kind: 'tool.end', tool: 'scrape_dexscreener_pair', ok: true, ms: 4200 },
    }),
  },
  { delayMs: 200, event: (now) => ({
      type: 'codex.line', ts: now(),
      line: '[codex] result: LP $1.4k, NOT locked, top wallet holds 38% supply, 6 sniper bots in first block',
    }),
  },

  // ── Tool 4: twitter (graceful failure → recover) ───────────────────────
  { delayMs: 500, event: (now) => ({
      type: 'codex.line', ts: now(),
      line: '[codex] one more cheap check: does the project even have a real social presence?',
    }),
  },
  { delayMs: 600, event: (now) => ({
      type: 'mcp.event', ts: now(),
      payload: { kind: 'tool.start', tool: 'scrape_twitter_profile', args: { handle: 'b4dc0ffee_token' } },
    }),
  },
  { delayMs: 200, event: (now) => ({
      type: 'mcp.event', ts: now(),
      payload: {
        kind: 'payment', tool: ACTOR_TWTR, status: 'required',
        amountUsdc: '0.3000', payTo: '0xApifyFacilitator…', ppeEvent: 'profile-fetched',
      },
    }),
  },
  { delayMs: 1700, event: (now) => ({
      type: 'mcp.event', ts: now(),
      payload: {
        kind: 'payment', tool: ACTOR_TWTR, status: 'settled',
        amountUsdc: '0.3000', payTo: '0xApifyFacilitator…', ppeEvent: 'profile-fetched',
      },
    }),
  },
  { delayMs: 1500, event: (now) => ({
      type: 'mcp.event', ts: now(),
      payload: { kind: 'tool.end', tool: 'scrape_twitter_profile', ok: true, ms: 3400 },
    }),
  },
  { delayMs: 200, event: (now) => ({
      type: 'codex.line', ts: now(),
      line: '[codex] result: account age 4h, 38 followers (mostly bots), bio links to a typo-squatted domain',
    }),
  },

  // ── Verdict ─────────────────────────────────────────────────────────────
  { delayMs: 700, event: (now) => ({
      type: 'codex.line', ts: now(),
      line: '[codex] enough evidence. Three independent red flags + one strong (serial deployer). Rendering verdict.',
    }),
  },
  { delayMs: 600, event: (now) => ({
      type: 'mcp.event', ts: now(),
      payload: {
        kind: 'tool.start', tool: 'render_verdict',
        args: {
          score: 92, label: 'LIKELY_RUG',
          reasons: [
            'Deployer launched 14 contracts in last 30 days; 11 already drained',
            'Liquidity pool not locked (only $1.4k, top wallet holds 38%)',
            'Twitter account age 4h, follower base appears synthetic',
            'Contract source unverified, deployed 2h13m ago',
          ],
        },
      },
    }),
  },
  { delayMs: 400, event: (now) => ({
      type: 'mcp.event', ts: now(),
      payload: { kind: 'tool.end', tool: 'render_verdict', ok: true, ms: 80 },
    }),
  },
  { delayMs: 200, event: (now) => ({
      type: 'codex.line', ts: now(),
      line: '[codex] VERDICT: {"score":92,"label":"LIKELY_RUG","spentUsdc":"0.6500","durationMs":31200}',
    }),
  },
  { delayMs: 300, event: (now) => ({
      type: 'investigation.completed', ts: now(), reason: 'verdict',
    }),
  },
];
