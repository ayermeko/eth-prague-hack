# Wallet Research Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four new MCP tools (`scrape_x_mentions`, `list_deployer_contracts`, `check_scam_blacklists`, `analyze_wallet_cluster`) plus an in-memory `WalletCache`, so the Codex investigator has richer signals for deployer/EOA wallet reputation.

**Architecture:** Hybrid backing — public Apify X-scraper Actor for X mentions; extend the existing `basescan-deep` Actor with a deployer-history route; direct HTTP to free GoPlus + ScamSniffer sources for blacklists; new `metasleuth-deep` Apify Actor for funding-cluster analysis. A sibling `WalletCache` module wraps each tool with per-tool TTL. The `tool.end` event gets an additive `cached?: boolean` field, surfaced through the existing SSE pipeline.

**Tech Stack:** TypeScript (NodeNext), vitest, `@modelcontextprotocol/sdk`, `@crawlee/playwright`, `apify` SDK, `@rugsleuth/x402-client` (existing). No new runtime deps in `rugcheck-mcp`.

**Spec:** [`docs/superpowers/specs/2026-05-10-wallet-research-sources-design.md`](../specs/2026-05-10-wallet-research-sources-design.md)

---

## File map

**Create (rugcheck-mcp):**
- `services/rugcheck-mcp/src/wallet-cache.ts` — `WalletCache` class
- `services/rugcheck-mcp/src/tools/with-cache.ts` — `withCache(fn, toolName, ttlMs)` adapter
- `services/rugcheck-mcp/src/blacklists/scam-sniffer.ts` — module-level `Set<address>` + 24h refresh
- `services/rugcheck-mcp/src/blacklists/goplus.ts` — single-address GoPlus call
- `services/rugcheck-mcp/src/tools/check-scam-blacklists.ts`
- `services/rugcheck-mcp/src/tools/scrape-x-mentions.ts`
- `services/rugcheck-mcp/src/tools/list-deployer-contracts.ts`
- `services/rugcheck-mcp/src/tools/analyze-wallet-cluster.ts`
- `services/rugcheck-mcp/test/wallet-cache.test.ts`
- `services/rugcheck-mcp/test/with-cache.test.ts`
- `services/rugcheck-mcp/test/scam-sniffer.test.ts`
- `services/rugcheck-mcp/test/goplus.test.ts`
- `services/rugcheck-mcp/test/check-scam-blacklists.test.ts`
- `services/rugcheck-mcp/test/scrape-x-mentions.test.ts`
- `services/rugcheck-mcp/test/list-deployer-contracts.test.ts`
- `services/rugcheck-mcp/test/analyze-wallet-cluster.test.ts`

**Create (metasleuth-deep Actor):**
- `actors/metasleuth-deep/src/main.ts`
- `actors/metasleuth-deep/src/routes.ts`
- `actors/metasleuth-deep/test/main.test.ts`
- `actors/metasleuth-deep/.actor/actor.json`
- `actors/metasleuth-deep/.actor/input_schema.json`
- `actors/metasleuth-deep/.actor/output_schema.json`
- `actors/metasleuth-deep/.actor/dataset_schema.json`
- `actors/metasleuth-deep/.actor/pricing_schema.json`
- `actors/metasleuth-deep/package.json`
- `actors/metasleuth-deep/tsconfig.json`
- `actors/metasleuth-deep/Dockerfile`
- `actors/metasleuth-deep/eslint.config.mjs`
- `actors/metasleuth-deep/.gitignore`

**Modify:**
- `services/rugcheck-mcp/src/events.ts` — add `cached?: boolean` to `tool.end`
- `services/rugcheck-mcp/src/index.ts` — register four new tools through `withCache`
- `services/orchestrator/src/events.ts` — mirror `cached?: boolean` on the `mcp.event` `tool.end` payload
- `actors/basescan-deep/src/routes.ts` — add `deployer-history` route handler
- `actors/basescan-deep/src/main.ts` — accept new optional `mode: 'address' | 'deployer-history'` input branch
- `actors/basescan-deep/.actor/input_schema.json` — add `mode` field
- `actors/basescan-deep/.actor/pricing_schema.json` — add `deployer-history-fetched` event
- `actors/basescan-deep/.actor/actor.json` — add the new event under `pricingPerEvent.actorChargeEvents`
- `actors/basescan-deep/test/main.test.ts` — fixture for deployer-history page + assertion
- `scripts/e2e-mock.sh` — extended fake fixture set, asserts new tool events appear

**Note on test runner:** all vitest commands below use `npx vitest run <path>` from the package directory or from repo root with `--config` resolved automatically. Each test file lives in `services/rugcheck-mcp/test/` (next to existing `scrape-basescan-address.test.ts`).

---

## Task 1: `WalletCache` module

**Files:**
- Create: `services/rugcheck-mcp/src/wallet-cache.ts`
- Test: `services/rugcheck-mcp/test/wallet-cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/rugcheck-mcp/test/wallet-cache.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { WalletCache } from '../src/wallet-cache.js';

describe('WalletCache', () => {
  it('returns null on a miss', () => {
    const c = new WalletCache();
    expect(c.get('0xabc', 'tool-a')).toBeNull();
  });

  it('returns a stored value within TTL', () => {
    const c = new WalletCache();
    c.set('0xabc', 'tool-a', { hello: 'world' }, 10_000);
    expect(c.get<{ hello: string }>('0xabc', 'tool-a')).toEqual({ hello: 'world' });
  });

  it('returns null after TTL has elapsed', () => {
    vi.useFakeTimers();
    try {
      const c = new WalletCache();
      c.set('0xabc', 'tool-a', 'v', 10_000);
      vi.advanceTimersByTime(10_001);
      expect(c.get('0xabc', 'tool-a')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps tool entries independent for the same wallet', () => {
    const c = new WalletCache();
    c.set('0xabc', 'tool-a', 1, 10_000);
    c.set('0xabc', 'tool-b', 2, 10_000);
    expect(c.get('0xabc', 'tool-a')).toBe(1);
    expect(c.get('0xabc', 'tool-b')).toBe(2);
  });

  it('treats wallet addresses case-insensitively', () => {
    const c = new WalletCache();
    c.set('0xABC', 'tool-a', 'v', 10_000);
    expect(c.get('0xabc', 'tool-a')).toBe('v');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run services/rugcheck-mcp/test/wallet-cache.test.ts
```

Expected: FAIL — `Cannot find module '../src/wallet-cache.js'`.

- [ ] **Step 3: Implement `WalletCache`**

Create `services/rugcheck-mcp/src/wallet-cache.ts`:

```ts
// services/rugcheck-mcp/src/wallet-cache.ts

interface Entry {
  value: unknown;
  expiresAt: number;
}

export class WalletCache {
  private readonly store = new Map<string, Entry>();

  private key(wallet: string, tool: string): string {
    return `${wallet.toLowerCase()}::${tool}`;
  }

  get<T>(wallet: string, tool: string): T | null {
    const entry = this.store.get(this.key(wallet, tool));
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(this.key(wallet, tool));
      return null;
    }
    return entry.value as T;
  }

  set(wallet: string, tool: string, value: unknown, ttlMs: number): void {
    this.store.set(this.key(wallet, tool), {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run services/rugcheck-mcp/test/wallet-cache.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add services/rugcheck-mcp/src/wallet-cache.ts services/rugcheck-mcp/test/wallet-cache.test.ts
git commit -m "feat(rugcheck-mcp): in-memory WalletCache with per-tool TTLs"
```

---

## Task 2: Extend `tool.end` with optional `cached?: boolean`

**Files:**
- Modify: `services/rugcheck-mcp/src/events.ts`
- Modify: `services/orchestrator/src/events.ts`
- Test: existing tests still pass; type-only change so no new test required.

- [ ] **Step 1: Modify `services/rugcheck-mcp/src/events.ts`**

Replace lines 7-18 (the `McpEvent` union) so the `tool.end` variant has an optional `cached`:

```ts
export type McpEvent =
  | { kind: 'tool.start'; tool: string; args: Record<string, unknown> }
  | { kind: 'tool.end'; tool: string; ok: boolean; error?: string; ms: number; cached?: boolean }
  | {
      kind: 'payment';
      tool: string;
      status: 'required' | 'signed' | 'settled' | 'failed';
      amountUsdc: string;
      payTo: string;
      ppeEvent?: string;
      error?: string;
    };
```

- [ ] **Step 2: Modify `services/orchestrator/src/events.ts`**

Replace the `tool.end` payload variant inside `mcp.event` (current line 25):

Find:
```ts
        | { kind: 'tool.end'; tool: string; ok: boolean; error?: string; ms: number }
```

Replace with:
```ts
        | { kind: 'tool.end'; tool: string; ok: boolean; error?: string; ms: number; cached?: boolean }
```

- [ ] **Step 3: Verify both packages still type-check and existing tests pass**

```bash
npm --workspace services/rugcheck-mcp run build
npm --workspace services/orchestrator run build
npx vitest run services/rugcheck-mcp/test/scrape-basescan-address.test.ts
npx vitest run services/orchestrator/test
```

Expected: all PASS, no type errors.

- [ ] **Step 4: Commit**

```bash
git add services/rugcheck-mcp/src/events.ts services/orchestrator/src/events.ts
git commit -m "feat: add optional cached flag to tool.end events"
```

---

## Task 3: `withCache` adapter

**Files:**
- Create: `services/rugcheck-mcp/src/tools/with-cache.ts`
- Test: `services/rugcheck-mcp/test/with-cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/rugcheck-mcp/test/with-cache.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { withCache } from '../src/tools/with-cache.js';
import { WalletCache } from '../src/wallet-cache.js';

const writes: string[] = [];
const stderrSpy = vi
  .spyOn(process.stderr, 'write')
  .mockImplementation((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  });

beforeEach(() => {
  writes.length = 0;
});

describe('withCache', () => {
  it('calls the underlying tool on a miss and stores the result', async () => {
    const cache = new WalletCache();
    const inner = vi.fn().mockResolvedValue({ value: 42, payments: [] });
    const wrapped = withCache(inner, { tool: 'demo_tool', ttlMs: 60_000, cache });

    const out = await wrapped({ address: '0xabc' });

    expect(out).toEqual({ value: 42, payments: [] });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(cache.get('0xabc', 'demo_tool')).toEqual({ value: 42, payments: [] });
  });

  it('serves a cached result without calling the inner tool', async () => {
    const cache = new WalletCache();
    cache.set('0xabc', 'demo_tool', { value: 'hit', payments: [] }, 60_000);
    const inner = vi.fn();
    const wrapped = withCache(inner, { tool: 'demo_tool', ttlMs: 60_000, cache });

    const out = await wrapped({ address: '0xabc' });

    expect(out).toEqual({ value: 'hit', payments: [] });
    expect(inner).not.toHaveBeenCalled();
    const lines = writes.join('').split('\n').filter(Boolean);
    const ends = lines.filter((l) => l.includes('"kind":"tool.end"'));
    expect(ends).toHaveLength(1);
    expect(ends[0]).toContain('"cached":true');
  });

  it('does not cache failed results', async () => {
    const cache = new WalletCache();
    const inner = vi.fn().mockRejectedValueOnce(new Error('boom'));
    const wrapped = withCache(inner, { tool: 'demo_tool', ttlMs: 60_000, cache });

    await expect(wrapped({ address: '0xabc' })).rejects.toThrow('boom');
    expect(cache.get('0xabc', 'demo_tool')).toBeNull();
  });
});

stderrSpy.mockRestore;
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run services/rugcheck-mcp/test/with-cache.test.ts
```

Expected: FAIL — `Cannot find module '../src/tools/with-cache.js'`.

- [ ] **Step 3: Implement `withCache`**

Create `services/rugcheck-mcp/src/tools/with-cache.ts`:

```ts
// services/rugcheck-mcp/src/tools/with-cache.ts
import { emit } from '../events.js';
import type { WalletCache } from '../wallet-cache.js';

export interface CachedToolInput {
  address: string;
}

export interface WithCacheOptions {
  tool: string;
  ttlMs: number;
  cache: WalletCache;
}

export function withCache<I extends CachedToolInput, O>(
  fn: (input: I) => Promise<O>,
  opts: WithCacheOptions,
): (input: I) => Promise<O> {
  return async (input: I): Promise<O> => {
    const cached = opts.cache.get<O>(input.address, opts.tool);
    if (cached !== null) {
      emit({ kind: 'tool.start', tool: opts.tool, args: { address: input.address } });
      emit({ kind: 'tool.end', tool: opts.tool, ok: true, ms: 0, cached: true });
      return cached;
    }
    const result = await fn(input);
    opts.cache.set(input.address, opts.tool, result, opts.ttlMs);
    return result;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run services/rugcheck-mcp/test/with-cache.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add services/rugcheck-mcp/src/tools/with-cache.ts services/rugcheck-mcp/test/with-cache.test.ts
git commit -m "feat(rugcheck-mcp): withCache adapter that emits cached tool.end events"
```

---

## Task 4: ScamSniffer blacklist module

**Files:**
- Create: `services/rugcheck-mcp/src/blacklists/scam-sniffer.ts`
- Test: `services/rugcheck-mcp/test/scam-sniffer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/rugcheck-mcp/test/scam-sniffer.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createScamSnifferChecker, SCAMSNIFFER_URL } from '../src/blacklists/scam-sniffer.js';

describe('scam-sniffer', () => {
  it('flags addresses present in the blacklist (case-insensitive)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ['0xBAD0000000000000000000000000000000000001'],
    });
    const check = createScamSnifferChecker({ fetch: fetchImpl });

    expect(await check('0xbad0000000000000000000000000000000000001')).toBe(true);
    expect(await check('0x1111111111111111111111111111111111111111')).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(SCAMSNIFFER_URL);
  });

  it('refreshes the list after the TTL elapses', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ['0xa'] })
        .mockResolvedValueOnce({ ok: true, json: async () => ['0xb'] });
      const check = createScamSnifferChecker({
        fetch: fetchImpl,
        ttlMs: 1_000,
      });

      expect(await check('0xa')).toBe(true);
      expect(await check('0xb')).toBe(false);
      vi.advanceTimersByTime(1_001);
      expect(await check('0xb')).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns false when the fetch fails (fail-soft)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const check = createScamSnifferChecker({ fetch: fetchImpl });
    expect(await check('0xa')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run services/rugcheck-mcp/test/scam-sniffer.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `scam-sniffer`**

Create `services/rugcheck-mcp/src/blacklists/scam-sniffer.ts`:

```ts
// services/rugcheck-mcp/src/blacklists/scam-sniffer.ts

export const SCAMSNIFFER_URL =
  'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface ScamSnifferOptions {
  fetch?: typeof globalThis.fetch;
  ttlMs?: number;
  url?: string;
}

export type ScamSnifferChecker = (address: string) => Promise<boolean>;

export function createScamSnifferChecker(opts: ScamSnifferOptions = {}): ScamSnifferChecker {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  const url = opts.url ?? SCAMSNIFFER_URL;

  let set: Set<string> = new Set();
  let loadedAt = 0;
  let inflight: Promise<void> | null = null;

  async function refresh(): Promise<void> {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) return; // fail-soft: keep the previous list (or empty)
      const data = (await res.json()) as unknown;
      if (!Array.isArray(data)) return;
      set = new Set(data.filter((s): s is string => typeof s === 'string').map((s) => s.toLowerCase()));
      loadedAt = Date.now();
    } catch {
      // fail-soft
    }
  }

  return async (address: string): Promise<boolean> => {
    if (Date.now() - loadedAt >= ttl) {
      inflight ??= refresh().finally(() => {
        inflight = null;
      });
      await inflight;
    }
    return set.has(address.toLowerCase());
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run services/rugcheck-mcp/test/scam-sniffer.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add services/rugcheck-mcp/src/blacklists/scam-sniffer.ts services/rugcheck-mcp/test/scam-sniffer.test.ts
git commit -m "feat(rugcheck-mcp): ScamSniffer blacklist checker with 24h refresh"
```

---

## Task 5: GoPlus client module

**Files:**
- Create: `services/rugcheck-mcp/src/blacklists/goplus.ts`
- Test: `services/rugcheck-mcp/test/goplus.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/rugcheck-mcp/test/goplus.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { fetchGoPlusFlags } from '../src/blacklists/goplus.js';

describe('goplus', () => {
  it('extracts severity-mapped flags from the address_security response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 1,
        message: 'OK',
        result: {
          cybercrime: '1',
          phishing_activities: '0',
          mixer: '1',
          sanctioned: '0',
          financial_crime: '1',
          honeypot_related_address: '0',
        },
      }),
    });

    const out = await fetchGoPlusFlags({
      address: '0xabc',
      chainId: 8453,
      fetch: fetchImpl,
    });

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    expect(out.flags.map((f) => f.flag).sort()).toEqual(
      ['cybercrime', 'financial_crime', 'mixer'].sort(),
    );
    expect(out.flags.find((f) => f.flag === 'cybercrime')?.severity).toBe('high');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.gopluslabs.io/api/v1/address_security/0xabc?chain_id=8453',
    );
  });

  it('returns ok=false when the upstream fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => '' });
    const out = await fetchGoPlusFlags({ address: '0xabc', chainId: 8453, fetch: fetchImpl });
    expect(out.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run services/rugcheck-mcp/test/goplus.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `goplus`**

Create `services/rugcheck-mcp/src/blacklists/goplus.ts`:

```ts
// services/rugcheck-mcp/src/blacklists/goplus.ts

export type GoPlusSeverity = 'low' | 'medium' | 'high';

export interface GoPlusFlag {
  flag: string;
  severity: GoPlusSeverity;
}

export type GoPlusResult =
  | { ok: true; flags: GoPlusFlag[] }
  | { ok: false; error: string };

const SEVERITY: Record<string, GoPlusSeverity> = {
  cybercrime: 'high',
  sanctioned: 'high',
  phishing_activities: 'high',
  financial_crime: 'high',
  mixer: 'medium',
  blackmail_activities: 'medium',
  honeypot_related_address: 'medium',
  stealing_attack: 'medium',
  fake_kyc: 'low',
  malicious_mining_activities: 'low',
};

export interface FetchGoPlusOptions {
  address: string;
  chainId: number;
  fetch?: typeof globalThis.fetch;
}

export async function fetchGoPlusFlags(opts: FetchGoPlusOptions): Promise<GoPlusResult> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const url = `https://api.gopluslabs.io/api/v1/address_security/${opts.address}?chain_id=${opts.chainId}`;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return { ok: false, error: `goplus ${res.status}` };
    const body = (await res.json()) as { result?: Record<string, string> };
    const result = body.result ?? {};
    const flags: GoPlusFlag[] = [];
    for (const [k, v] of Object.entries(result)) {
      if (v === '1' && SEVERITY[k]) {
        flags.push({ flag: k, severity: SEVERITY[k] });
      }
    }
    return { ok: true, flags };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run services/rugcheck-mcp/test/goplus.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add services/rugcheck-mcp/src/blacklists/goplus.ts services/rugcheck-mcp/test/goplus.test.ts
git commit -m "feat(rugcheck-mcp): GoPlus address_security client with severity mapping"
```

---

## Task 6: `check_scam_blacklists` tool

**Files:**
- Create: `services/rugcheck-mcp/src/tools/check-scam-blacklists.ts`
- Test: `services/rugcheck-mcp/test/check-scam-blacklists.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/rugcheck-mcp/test/check-scam-blacklists.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { checkScamBlacklists } from '../src/tools/check-scam-blacklists.js';

describe('check_scam_blacklists', () => {
  it('combines GoPlus flags and ScamSniffer hits', async () => {
    const goplus = vi.fn().mockResolvedValue({
      ok: true,
      flags: [{ flag: 'cybercrime', severity: 'high' }],
    });
    const scamSniffer = vi.fn().mockResolvedValue(true);

    const out = await checkScamBlacklists({
      address: '0xabc',
      goPlus: goplus,
      scamSnifferCheck: scamSniffer,
    });

    expect(out.clean).toBe(false);
    expect(out.hits).toEqual(
      expect.arrayContaining([
        { source: 'goplus', flag: 'cybercrime', severity: 'high' },
        { source: 'scamsniffer', flag: 'listed', severity: 'high' },
      ]),
    );
    expect(out.sources).toEqual({ goplus: 'ok', scamsniffer: 'ok' });
    expect(out.payments).toEqual([]);
  });

  it('reports clean=true when no hits and both sources OK', async () => {
    const out = await checkScamBlacklists({
      address: '0xabc',
      goPlus: async () => ({ ok: true, flags: [] }),
      scamSnifferCheck: async () => false,
    });
    expect(out.clean).toBe(true);
    expect(out.hits).toEqual([]);
  });

  it('records goplus error in sources and still returns scam-sniffer result', async () => {
    const out = await checkScamBlacklists({
      address: '0xabc',
      goPlus: async () => ({ ok: false, error: 'boom' }),
      scamSnifferCheck: async () => true,
    });
    expect(out.sources).toEqual({ goplus: 'error', scamsniffer: 'ok' });
    expect(out.hits).toEqual([
      { source: 'scamsniffer', flag: 'listed', severity: 'high' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run services/rugcheck-mcp/test/check-scam-blacklists.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tool**

Create `services/rugcheck-mcp/src/tools/check-scam-blacklists.ts`:

```ts
// services/rugcheck-mcp/src/tools/check-scam-blacklists.ts
import { emit } from '../events.js';
import type { GoPlusResult } from '../blacklists/goplus.js';
import type { ScamSnifferChecker } from '../blacklists/scam-sniffer.js';

export interface CheckScamBlacklistsInput {
  address: string;
  goPlus: (opts: { address: string }) => Promise<GoPlusResult>;
  scamSnifferCheck: ScamSnifferChecker;
}

export interface BlacklistHit {
  source: 'goplus' | 'scamsniffer';
  flag: string;
  severity: 'low' | 'medium' | 'high';
}

export interface CheckScamBlacklistsOutput {
  address: string;
  hits: BlacklistHit[];
  clean: boolean;
  sources: { goplus: 'ok' | 'error'; scamsniffer: 'ok' | 'error' };
  payments: [];
}

export async function checkScamBlacklists(
  input: CheckScamBlacklistsInput,
): Promise<CheckScamBlacklistsOutput> {
  const tool = 'check_scam_blacklists';
  const start = Date.now();
  emit({ kind: 'tool.start', tool, args: { address: input.address } });

  const [goRes, snifferRes] = await Promise.all([
    input.goPlus({ address: input.address }).catch(
      (err): GoPlusResult => ({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }),
    ),
    input.scamSnifferCheck(input.address).then(
      (hit) => ({ ok: true as const, hit }),
      (err) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }),
    ),
  ]);

  const hits: BlacklistHit[] = [];
  if (goRes.ok) {
    for (const f of goRes.flags) {
      hits.push({ source: 'goplus', flag: f.flag, severity: f.severity });
    }
  }
  if (snifferRes.ok && snifferRes.hit) {
    hits.push({ source: 'scamsniffer', flag: 'listed', severity: 'high' });
  }

  const sources = {
    goplus: goRes.ok ? ('ok' as const) : ('error' as const),
    scamsniffer: snifferRes.ok ? ('ok' as const) : ('error' as const),
  };

  emit({ kind: 'tool.end', tool, ok: true, ms: Date.now() - start });

  return {
    address: input.address,
    hits,
    clean: hits.length === 0,
    sources,
    payments: [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run services/rugcheck-mcp/test/check-scam-blacklists.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add services/rugcheck-mcp/src/tools/check-scam-blacklists.ts services/rugcheck-mcp/test/check-scam-blacklists.test.ts
git commit -m "feat(rugcheck-mcp): check_scam_blacklists tool combining GoPlus + ScamSniffer"
```

---

## Task 7: `scrape_x_mentions` tool

**Files:**
- Create: `services/rugcheck-mcp/src/tools/scrape-x-mentions.ts`
- Test: `services/rugcheck-mcp/test/scrape-x-mentions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/rugcheck-mcp/test/scrape-x-mentions.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { scrapeXMentions } from '../src/tools/scrape-x-mentions.js';

describe('scrape_x_mentions', () => {
  it('runs the literal-address query and returns mentions + payments', async () => {
    const actorClient = {
      runActor: vi.fn().mockResolvedValueOnce({
        result: [
          {
            user: { name: 'Alice', username: 'alice' },
            text: 'pump 0xabc to the moon',
            url: 'https://x.com/alice/status/1',
            createdAt: '2026-05-01T00:00:00Z',
            likeCount: 3,
            replyCount: 0,
          },
        ],
        payments: [
          {
            id: 'p1',
            status: 'settled' as const,
            amountUsdc: '0.04',
            payTo: '0xbee',
            ppeEvent: 'tweet-fetched',
            ts: '2026-05-01T00:00:00Z',
          },
        ],
      }),
    };

    const out = await scrapeXMentions({
      address: '0xabc',
      actorClient,
      actorId: 'apidojo/twitter-scraper-lite',
      linkedHandle: null,
      maxTweets: 25,
    });

    expect(out.address).toBe('0xabc');
    expect(out.literalMentions).toHaveLength(1);
    expect(out.literalMentions[0]).toEqual({
      author: 'Alice',
      handle: 'alice',
      text: 'pump 0xabc to the moon',
      url: 'https://x.com/alice/status/1',
      createdAt: '2026-05-01T00:00:00Z',
      likeCount: 3,
      replyCount: 0,
    });
    expect(out.authoredByLinkedHandle).toEqual([]);
    expect(out.facts).toEqual({ mentionCount: 1, linkedHandle: null });
    expect(out.payments).toHaveLength(1);
    expect(actorClient.runActor).toHaveBeenCalledTimes(1);
  });

  it('runs the from:handle query when linkedHandle is provided', async () => {
    const actorClient = {
      runActor: vi
        .fn()
        .mockResolvedValueOnce({ result: [], payments: [] })
        .mockResolvedValueOnce({
          result: [
            {
              user: { name: 'Dev', username: 'dev' },
              text: 'shipping a new contract today',
              url: 'https://x.com/dev/status/2',
              createdAt: '2026-05-02T00:00:00Z',
              likeCount: 0,
              replyCount: 0,
            },
          ],
          payments: [],
        }),
    };

    const out = await scrapeXMentions({
      address: '0xabc',
      actorClient,
      actorId: 'apidojo/twitter-scraper-lite',
      linkedHandle: 'dev',
      maxTweets: 25,
    });

    expect(actorClient.runActor).toHaveBeenCalledTimes(2);
    expect(out.authoredByLinkedHandle).toHaveLength(1);
    expect(out.facts.linkedHandle).toBe('dev');
  });

  it('emits ok=false on Actor failure and returns empty arrays', async () => {
    const actorClient = {
      runActor: vi.fn().mockRejectedValue(new Error('actor blew up')),
    };

    const out = await scrapeXMentions({
      address: '0xabc',
      actorClient,
      actorId: 'apidojo/twitter-scraper-lite',
      linkedHandle: null,
    });

    expect(out.literalMentions).toEqual([]);
    expect(out.authoredByLinkedHandle).toEqual([]);
    expect(out.payments).toEqual([]);
    expect(out.facts.mentionCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run services/rugcheck-mcp/test/scrape-x-mentions.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tool**

Create `services/rugcheck-mcp/src/tools/scrape-x-mentions.ts`:

```ts
// services/rugcheck-mcp/src/tools/scrape-x-mentions.ts
import type { PaymentEvent } from '@rugsleuth/x402-client';
import type { ApifyActorClient } from '../apify-client.js';
import { emit } from '../events.js';

export interface ScrapeXMentionsInput {
  address: string;
  actorClient: ApifyActorClient;
  actorId: string;
  linkedHandle?: string | null;
  maxTweets?: number;
}

export interface XTweet {
  author: string;
  handle: string;
  text: string;
  url: string;
  createdAt: string;
  likeCount: number;
  replyCount: number;
}

export interface ScrapeXMentionsOutput {
  address: string;
  literalMentions: XTweet[];
  authoredByLinkedHandle: XTweet[];
  facts: { mentionCount: number; linkedHandle: string | null };
  payments: PaymentEvent[];
}

type RawTweet = {
  user?: { name?: string; username?: string };
  text?: string;
  url?: string;
  createdAt?: string;
  likeCount?: number;
  replyCount?: number;
};

function normalize(raw: RawTweet[]): XTweet[] {
  return raw
    .filter((t) => typeof t.text === 'string' && typeof t.url === 'string')
    .map((t) => ({
      author: t.user?.name ?? '',
      handle: t.user?.username ?? '',
      text: t.text ?? '',
      url: t.url ?? '',
      createdAt: t.createdAt ?? '',
      likeCount: typeof t.likeCount === 'number' ? t.likeCount : 0,
      replyCount: typeof t.replyCount === 'number' ? t.replyCount : 0,
    }));
}

export async function scrapeXMentions(
  input: ScrapeXMentionsInput,
): Promise<ScrapeXMentionsOutput> {
  const tool = 'scrape_x_mentions';
  const start = Date.now();
  const linkedHandle = input.linkedHandle ?? null;
  const maxTweets = input.maxTweets ?? 25;

  emit({
    kind: 'tool.start',
    tool,
    args: { address: input.address, linkedHandle, maxTweets },
  });

  try {
    const literalRun = await input.actorClient.runActor<RawTweet[]>({
      actorId: input.actorId,
      input: { searchTerms: [`"${input.address}"`], maxTweets },
    });

    let handleRun: { result: RawTweet[]; payments: PaymentEvent[] } | null = null;
    if (linkedHandle) {
      handleRun = await input.actorClient.runActor<RawTweet[]>({
        actorId: input.actorId,
        input: { searchTerms: [`from:${linkedHandle}`], maxTweets },
      });
    }

    const literal = normalize(literalRun.result ?? []);
    const authored = handleRun ? normalize(handleRun.result ?? []) : [];
    const payments = [...literalRun.payments, ...(handleRun?.payments ?? [])];

    for (const p of payments) {
      emit({
        kind: 'payment',
        tool,
        status: p.status,
        amountUsdc: p.amountUsdc,
        payTo: p.payTo,
        ppeEvent: p.ppeEvent,
        error: p.error,
      });
    }

    emit({ kind: 'tool.end', tool, ok: true, ms: Date.now() - start });
    return {
      address: input.address,
      literalMentions: literal,
      authoredByLinkedHandle: authored,
      facts: { mentionCount: literal.length, linkedHandle },
      payments,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ kind: 'tool.end', tool, ok: false, error: message, ms: Date.now() - start });
    return {
      address: input.address,
      literalMentions: [],
      authoredByLinkedHandle: [],
      facts: { mentionCount: 0, linkedHandle },
      payments: [],
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run services/rugcheck-mcp/test/scrape-x-mentions.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add services/rugcheck-mcp/src/tools/scrape-x-mentions.ts services/rugcheck-mcp/test/scrape-x-mentions.test.ts
git commit -m "feat(rugcheck-mcp): scrape_x_mentions tool calling public X scraper Actor"
```

---

## Task 8: Extend `basescan-deep` Actor with `deployer-history` route

**Files:**
- Modify: `actors/basescan-deep/src/main.ts`
- Modify: `actors/basescan-deep/src/routes.ts`
- Modify: `actors/basescan-deep/.actor/input_schema.json`
- Modify: `actors/basescan-deep/.actor/pricing_schema.json`
- Modify: `actors/basescan-deep/.actor/actor.json`
- Modify: `actors/basescan-deep/test/main.test.ts`

- [ ] **Step 1: Write the failing test**

Append the following describe block to `actors/basescan-deep/test/main.test.ts` (after the existing `describe('PlaywrightCrawler', ...)` block):

```ts
describe('deployer-history route', () => {
  const address = '0xc1fcc4300305a415a7ea894f71a0694e9f7831d3';
  let server: Server;
  let url: string;

  beforeAll(async () => {
    await purgeDefaultStorages();
    vi.spyOn(Actor, 'charge').mockResolvedValue(undefined as never);

    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`
        <!doctype html>
        <html><body>
          <h1>Address Overview</h1>
          <span>First Tx: 2025-01-01</span>
          <table id="ContractsCreated" class="table">
            <tbody>
              <tr>
                <td><a href="/address/0x1111111111111111111111111111111111111111">0x1111…1111</a></td>
                <td>Verified</td>
                <td>MyToken</td>
                <td>2025-02-01</td>
                <td>120 holders</td>
              </tr>
              <tr>
                <td><a href="/address/0x2222222222222222222222222222222222222222">0x2222…2222</a></td>
                <td>Unverified</td>
                <td></td>
                <td>2025-04-15</td>
                <td>2 holders</td>
              </tr>
            </tbody>
          </table>
        </body></html>
      `);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;
    url = `http://127.0.0.1:${port}/address/${address}#contractscreated`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    vi.restoreAllMocks();
  });

  it('extracts deployer contract list and charges deployer-history-fetched', async () => {
    const crawler = new PlaywrightCrawler({ maxRequestsPerCrawl: 1, requestHandler: router });
    await crawler.run([
      { url, userData: { address, mode: 'deployer-history' as const } },
    ]);

    const { items } = await crawler.getData();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      address,
      mode: 'deployer-history',
      totalContractsDeployed: 2,
      contracts: [
        expect.objectContaining({
          contractAddress: '0x1111111111111111111111111111111111111111',
          isVerified: true,
          name: 'MyToken',
          holderCount: 120,
          suspicious: false,
        }),
        expect.objectContaining({
          contractAddress: '0x2222222222222222222222222222222222222222',
          isVerified: false,
          holderCount: 2,
          suspicious: true,
        }),
      ],
    });
    expect(Actor.charge).toHaveBeenCalledWith({ eventName: 'deployer-history-fetched' });
  }, 60_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd actors/basescan-deep && npx vitest run
```

Expected: FAIL — the `deployer-history` route doesn't exist.

- [ ] **Step 3: Modify `actors/basescan-deep/src/main.ts`**

Replace its full contents with:

```ts
import { PlaywrightCrawler } from '@crawlee/playwright';
import { Actor } from 'apify';

import { router } from './routes.js';

interface Input {
  address: string;
  mode?: 'address' | 'deployer-history';
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

await Actor.init();

const input = (await Actor.getInput<Input>()) ?? ({} as Input);
const address = input.address?.trim();
const mode = input.mode ?? 'address';

if (!address || !ADDRESS_RE.test(address)) {
  await Actor.fail('Invalid address: expected 0x-prefixed 40 hex characters.');
}

const url =
  mode === 'deployer-history'
    ? `https://basescan.org/address/${address}#contractscreated`
    : `https://basescan.org/address/${address}`;

const proxyConfiguration = await Actor.createProxyConfiguration({ checkAccess: false });

const crawler = new PlaywrightCrawler({
  proxyConfiguration,
  maxRequestsPerCrawl: 1,
  requestHandler: router,
  launchContext: {
    launchOptions: { args: ['--disable-gpu'] },
  },
});

await crawler.run([{ url, userData: { address, mode } }]);

await Actor.exit();
```

- [ ] **Step 4: Modify `actors/basescan-deep/src/routes.ts`**

Replace its full contents with:

```ts
import { createPlaywrightRouter } from '@crawlee/playwright';
import { Actor } from 'apify';

export const router = createPlaywrightRouter();

interface UserData {
  address?: string;
  mode?: 'address' | 'deployer-history';
}

router.addDefaultHandler(async ({ request, page, log, pushData }) => {
  const data = (request.userData ?? {}) as UserData;
  const address = data.address ?? '';
  const mode = data.mode ?? 'address';

  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  if (mode === 'deployer-history') {
    log.info(`Scraping BaseScan deployer history`, { url: request.loadedUrl, address });

    const rows = page.locator('table#ContractsCreated tbody tr, table.table tbody tr');
    const rowCount = Math.min(await rows.count(), 25);
    const contracts: Array<{
      contractAddress: string;
      deployedAt: string;
      isVerified: boolean;
      name: string | null;
      holderCount: number | null;
      suspicious: boolean;
    }> = [];

    for (let i = 0; i < rowCount; i += 1) {
      const row = rows.nth(i);
      const link = row.locator('a[href*="/address/0x"]').first();
      const href = (await link.getAttribute('href')) ?? '';
      const contractAddress = (href.match(/0x[a-fA-F0-9]{40}/) ?? [''])[0];
      if (!contractAddress) continue;

      const cells = row.locator('td');
      const cellCount = await cells.count();
      const cellTexts: string[] = [];
      for (let c = 0; c < cellCount; c += 1) {
        cellTexts.push((await cells.nth(c).innerText()).trim());
      }

      const isVerified = cellTexts.some((t) => /Verified/i.test(t));
      const nameCellIdx = cellTexts.findIndex((t) => /^[A-Za-z][A-Za-z0-9 _-]{0,40}$/.test(t) && !/Verified|Unverified/i.test(t));
      const name = nameCellIdx >= 0 ? cellTexts[nameCellIdx] : null;
      const dateMatch = cellTexts.find((t) => /\d{4}-\d{2}-\d{2}/.test(t)) ?? '';
      const holderMatch = (cellTexts.find((t) => /\d+\s+holders/i.test(t)) ?? '').match(/(\d+)/);
      const holderCount = holderMatch ? Number(holderMatch[1]) : null;

      contracts.push({
        contractAddress,
        deployedAt: (dateMatch.match(/\d{4}-\d{2}-\d{2}/) ?? [''])[0],
        isVerified,
        name,
        holderCount,
        suspicious: !isVerified && (holderCount === null || holderCount < 10),
      });
    }

    const firstTxText = (await page.locator('text=/First Tx/i').first().innerText().catch(() => '')) ?? '';
    const firstTxDateMatch = firstTxText.match(/\d{4}-\d{2}-\d{2}/);
    const deployerAgeDays = firstTxDateMatch
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - Date.parse(firstTxDateMatch[0])) / (24 * 60 * 60 * 1000),
          ),
        )
      : 0;

    const recent = contracts.filter((c) => {
      if (!c.deployedAt) return false;
      const ts = Date.parse(c.deployedAt);
      return Number.isFinite(ts) && Date.now() - ts < 30 * 24 * 60 * 60 * 1000;
    });
    const unverified = contracts.filter((c) => !c.isVerified);

    await pushData({
      address,
      mode: 'deployer-history',
      url: request.loadedUrl,
      totalContractsDeployed: contracts.length,
      contracts,
      signals: {
        deployerAgeDays,
        serialDeployer: recent.length > 5,
        unverifiedRatio: contracts.length === 0 ? 0 : unverified.length / contracts.length,
      },
      scrapedAt: new Date().toISOString(),
    });
    await Actor.charge({ eventName: 'deployer-history-fetched' });
    return;
  }

  log.info(`Scraping BaseScan address page`, { url: request.loadedUrl, address });

  const title = await page.title();

  let ethBalance: string | null = null;
  try {
    const card = page.locator('div.card').filter({ hasText: 'ETH Balance' }).first();
    if (await card.isVisible()) {
      ethBalance = (await card.innerText()).trim();
    }
  } catch (err) {
    log.warning(`Could not extract ETH balance: ${String(err)}`);
  }

  const isContract =
    (await page.locator('a[href*="#code"]:has-text("Contract")').count()) > 0;

  const verified =
    (await page
      .locator('span:has-text("Contract Source Code Verified")')
      .count()) > 0;

  const txRowsRaw: string[] = [];
  try {
    const rows = page.locator('table.table tbody tr');
    const count = Math.min(await rows.count(), 5);
    for (let i = 0; i < count; i += 1) {
      txRowsRaw.push((await rows.nth(i).innerText()).trim());
    }
  } catch (err) {
    log.warning(`Could not extract transactions: ${String(err)}`);
  }

  await pushData({
    address,
    mode: 'address',
    url: request.loadedUrl,
    title,
    ethBalance,
    isContract,
    verified,
    latestTxs: txRowsRaw,
    scrapedAt: new Date().toISOString(),
  });
  await Actor.charge({ eventName: 'address-fetched' });
});
```

- [ ] **Step 5: Modify `actors/basescan-deep/.actor/input_schema.json`**

Replace its full contents with:

```json
{
  "$schema": "https://apify.com/schemas/v1/input.ide.json",
  "title": "RugSleuth basescan-deep",
  "type": "object",
  "schemaVersion": 1,
  "properties": {
    "address": {
      "title": "Contract or wallet address",
      "type": "string",
      "description": "Base address (0x-prefixed, 40 hex chars).",
      "editor": "textfield",
      "pattern": "^0x[a-fA-F0-9]{40}$",
      "prefill": "0xc1fcc4300305a415a7ea894f71a0694e9f7831d3"
    },
    "mode": {
      "title": "Scrape mode",
      "type": "string",
      "description": "address = single page; deployer-history = list contracts created by this wallet",
      "editor": "select",
      "enum": ["address", "deployer-history"],
      "default": "address"
    }
  },
  "required": ["address"]
}
```

- [ ] **Step 6: Modify `actors/basescan-deep/.actor/pricing_schema.json`**

Replace its full contents with:

```json
{
  "$schema": "https://apify.com/schemas/v1/pricing.ide.json",
  "pricingModel": "PAY_PER_EVENT",
  "events": {
    "address-fetched": {
      "title": "Address fetched",
      "description": "One BaseScan address page scraped.",
      "priceUsd": 0.05
    },
    "deployer-history-fetched": {
      "title": "Deployer history fetched",
      "description": "Wallet's full contract-deployment history scraped (one call covers the wallet page + all contract drill-downs).",
      "priceUsd": 0.08
    }
  }
}
```

- [ ] **Step 7: Modify `actors/basescan-deep/.actor/actor.json`**

Replace the `pricingInfos[0].pricingPerEvent.actorChargeEvents` block to add the new event. Final file:

```json
{
  "$schema": "https://apify.com/schemas/v1/actor.ide.json",
  "actorSpecification": 1,
  "name": "basescan-deep",
  "title": "BaseScan Deep (RugSleuth)",
  "description": "Pay-Per-Event BaseScan scraper for the RugSleuth investigator agent.",
  "version": "0.1",
  "meta": {
    "templateId": "ts-crawlee-playwright-chrome",
    "generatedBy": "Claude Opus 4.7"
  },
  "input": "./input_schema.json",
  "output": "./output_schema.json",
  "storages": {
    "dataset": "./dataset_schema.json"
  },
  "pricingInfos": [
    {
      "pricingModel": "PAY_PER_EVENT",
      "pricingPerEvent": {
        "actorChargeEvents": {
          "address-fetched": {
            "eventTitle": "Address fetched",
            "eventDescription": "One BaseScan address page scraped (balance, contract status, recent txs).",
            "eventPriceUsd": 0.05
          },
          "deployer-history-fetched": {
            "eventTitle": "Deployer history fetched",
            "eventDescription": "Wallet's contract-deployment history scraped (one call covers the wallet page + drill-downs).",
            "eventPriceUsd": 0.08
          }
        }
      }
    }
  ],
  "dockerfile": "../Dockerfile"
}
```

- [ ] **Step 8: Run all basescan-deep tests**

```bash
cd actors/basescan-deep && npx vitest run
```

Expected: PASS — original `should crawl and push data to dataset` test still passes; new `extracts deployer contract list and charges deployer-history-fetched` passes.

- [ ] **Step 9: Commit**

```bash
git add actors/basescan-deep/src/main.ts actors/basescan-deep/src/routes.ts actors/basescan-deep/.actor/input_schema.json actors/basescan-deep/.actor/pricing_schema.json actors/basescan-deep/.actor/actor.json actors/basescan-deep/test/main.test.ts
git commit -m "feat(basescan-deep): add deployer-history mode + PPE event"
```

---

## Task 9: `list_deployer_contracts` tool

**Files:**
- Create: `services/rugcheck-mcp/src/tools/list-deployer-contracts.ts`
- Test: `services/rugcheck-mcp/test/list-deployer-contracts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/rugcheck-mcp/test/list-deployer-contracts.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { listDeployerContracts } from '../src/tools/list-deployer-contracts.js';

describe('list_deployer_contracts', () => {
  it('passes mode=deployer-history to the basescan-deep Actor and returns the dataset shape', async () => {
    const actorClient = {
      runActor: vi.fn().mockResolvedValue({
        result: [
          {
            address: '0xabc',
            mode: 'deployer-history',
            totalContractsDeployed: 1,
            contracts: [
              {
                contractAddress: '0x1111111111111111111111111111111111111111',
                deployedAt: '2025-02-01',
                isVerified: true,
                name: 'MyToken',
                holderCount: 120,
                suspicious: false,
              },
            ],
            signals: { deployerAgeDays: 400, serialDeployer: false, unverifiedRatio: 0 },
            scrapedAt: '2026-05-10T00:00:00Z',
          },
        ],
        payments: [
          {
            id: 'p1',
            status: 'settled' as const,
            amountUsdc: '0.08',
            payTo: '0xbee',
            ppeEvent: 'deployer-history-fetched',
            ts: '2026-05-10T00:00:00Z',
          },
        ],
      }),
    };

    const out = await listDeployerContracts({
      address: '0xabc',
      actorClient,
      actorId: 'team/basescan-deep',
    });

    expect(actorClient.runActor).toHaveBeenCalledWith({
      actorId: 'team/basescan-deep',
      input: { address: '0xabc', mode: 'deployer-history' },
    });
    expect(out.totalContractsDeployed).toBe(1);
    expect(out.contracts[0].contractAddress).toBe('0x1111111111111111111111111111111111111111');
    expect(out.signals.deployerAgeDays).toBe(400);
    expect(out.payments).toHaveLength(1);
  });

  it('returns an empty result on Actor failure', async () => {
    const actorClient = {
      runActor: vi.fn().mockRejectedValue(new Error('actor crashed')),
    };
    const out = await listDeployerContracts({
      address: '0xabc',
      actorClient,
      actorId: 'team/basescan-deep',
    });
    expect(out.totalContractsDeployed).toBe(0);
    expect(out.contracts).toEqual([]);
    expect(out.payments).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run services/rugcheck-mcp/test/list-deployer-contracts.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tool**

Create `services/rugcheck-mcp/src/tools/list-deployer-contracts.ts`:

```ts
// services/rugcheck-mcp/src/tools/list-deployer-contracts.ts
import type { PaymentEvent } from '@rugsleuth/x402-client';
import type { ApifyActorClient } from '../apify-client.js';
import { emit } from '../events.js';

export interface DeployedContract {
  contractAddress: string;
  deployedAt: string;
  isVerified: boolean;
  name: string | null;
  holderCount: number | null;
  suspicious: boolean;
}

export interface DeployerSignals {
  deployerAgeDays: number;
  serialDeployer: boolean;
  unverifiedRatio: number;
}

export interface ListDeployerContractsInput {
  address: string;
  actorClient: ApifyActorClient;
  actorId: string;
  maxContracts?: number;
}

export interface ListDeployerContractsOutput {
  address: string;
  totalContractsDeployed: number;
  contracts: DeployedContract[];
  signals: DeployerSignals;
  payments: PaymentEvent[];
}

type RawDataset = Array<{
  address?: string;
  totalContractsDeployed?: number;
  contracts?: DeployedContract[];
  signals?: DeployerSignals;
}>;

export async function listDeployerContracts(
  input: ListDeployerContractsInput,
): Promise<ListDeployerContractsOutput> {
  const tool = 'list_deployer_contracts';
  const start = Date.now();
  emit({ kind: 'tool.start', tool, args: { address: input.address } });

  const empty: ListDeployerContractsOutput = {
    address: input.address,
    totalContractsDeployed: 0,
    contracts: [],
    signals: { deployerAgeDays: 0, serialDeployer: false, unverifiedRatio: 0 },
    payments: [],
  };

  try {
    const res = await input.actorClient.runActor<RawDataset>({
      actorId: input.actorId,
      input: { address: input.address, mode: 'deployer-history' },
    });

    for (const p of res.payments) {
      emit({
        kind: 'payment',
        tool,
        status: p.status,
        amountUsdc: p.amountUsdc,
        payTo: p.payTo,
        ppeEvent: p.ppeEvent,
        error: p.error,
      });
    }

    const item = res.result[0];
    if (!item) {
      emit({ kind: 'tool.end', tool, ok: true, ms: Date.now() - start });
      return { ...empty, payments: res.payments };
    }

    emit({ kind: 'tool.end', tool, ok: true, ms: Date.now() - start });
    return {
      address: item.address ?? input.address,
      totalContractsDeployed: item.totalContractsDeployed ?? 0,
      contracts: item.contracts ?? [],
      signals: item.signals ?? empty.signals,
      payments: res.payments,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ kind: 'tool.end', tool, ok: false, error: message, ms: Date.now() - start });
    return empty;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run services/rugcheck-mcp/test/list-deployer-contracts.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add services/rugcheck-mcp/src/tools/list-deployer-contracts.ts services/rugcheck-mcp/test/list-deployer-contracts.test.ts
git commit -m "feat(rugcheck-mcp): list_deployer_contracts tool driving basescan-deep deployer-history mode"
```

---

## Task 10: Scaffold `metasleuth-deep` Apify Actor

**Files:**
- Create: `actors/metasleuth-deep/package.json`
- Create: `actors/metasleuth-deep/tsconfig.json`
- Create: `actors/metasleuth-deep/Dockerfile`
- Create: `actors/metasleuth-deep/eslint.config.mjs`
- Create: `actors/metasleuth-deep/.gitignore`
- Create: `actors/metasleuth-deep/.actor/actor.json`
- Create: `actors/metasleuth-deep/.actor/input_schema.json`
- Create: `actors/metasleuth-deep/.actor/output_schema.json`
- Create: `actors/metasleuth-deep/.actor/dataset_schema.json`
- Create: `actors/metasleuth-deep/.actor/pricing_schema.json`

This task is config-only — implementation files come in Task 11 (TDD).

- [ ] **Step 1: Create `actors/metasleuth-deep/package.json`** (same toolchain as basescan-deep, different name)

```json
{
  "name": "metasleuth-deep",
  "version": "0.0.1",
  "type": "module",
  "description": "MetaSleuth wallet-cluster scraper for the RugSleuth investigator agent.",
  "engines": { "node": ">=18.0.0" },
  "dependencies": {
    "apify": "^3.7.0",
    "@crawlee/playwright": "^3.15.3",
    "playwright": "1.59.1"
  },
  "devDependencies": {
    "@apify/eslint-config": "^2.0.0",
    "@apify/tsconfig": "^0.1.1",
    "@types/node": "^24.0.0",
    "eslint": "^9.29.0",
    "eslint-config-prettier": "^10.1.5",
    "globals": "^17.0.0",
    "prettier": "^3.5.3",
    "tsx": "^4.20.3",
    "typescript": "^6.0.0",
    "typescript-eslint": "^8.58.0",
    "vitest": "^4.1.0"
  },
  "scripts": {
    "start": "npm run start:dev",
    "start:prod": "node dist/main.js",
    "start:dev": "tsx src/main.ts",
    "build": "tsc",
    "lint": "eslint",
    "lint:fix": "eslint --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "postinstall": "npx crawlee install-playwright-browsers"
  },
  "license": "ISC"
}
```

- [ ] **Step 2: Create `actors/metasleuth-deep/tsconfig.json`** (mirror of basescan-deep)

```json
{
  "extends": "@apify/tsconfig",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "outDir": "dist",
    "rootDir": "./src",
    "incremental": false,
    "noUnusedLocals": false,
    "skipLibCheck": true,
    "lib": ["DOM"]
  },
  "include": ["./src/**/*"]
}
```

- [ ] **Step 3: Copy `Dockerfile` from basescan-deep**

```bash
cp actors/basescan-deep/Dockerfile actors/metasleuth-deep/Dockerfile
```

- [ ] **Step 4: Create `actors/metasleuth-deep/eslint.config.mjs`**

```bash
cp actors/basescan-deep/eslint.config.mjs actors/metasleuth-deep/eslint.config.mjs
```

- [ ] **Step 5: Create `actors/metasleuth-deep/.gitignore`**

```
node_modules/
dist/
storage/
.DS_Store
```

- [ ] **Step 6: Create `actors/metasleuth-deep/.actor/actor.json`**

```json
{
  "$schema": "https://apify.com/schemas/v1/actor.ide.json",
  "actorSpecification": 1,
  "name": "metasleuth-deep",
  "title": "MetaSleuth Deep (RugSleuth)",
  "description": "Pay-Per-Event MetaSleuth wallet-cluster scraper for the RugSleuth investigator agent.",
  "version": "0.1",
  "meta": {
    "templateId": "ts-crawlee-playwright-chrome",
    "generatedBy": "Claude Opus 4.7"
  },
  "input": "./input_schema.json",
  "output": "./output_schema.json",
  "storages": { "dataset": "./dataset_schema.json" },
  "pricingInfos": [
    {
      "pricingModel": "PAY_PER_EVENT",
      "pricingPerEvent": {
        "actorChargeEvents": {
          "cluster-fetched": {
            "eventTitle": "Cluster fetched",
            "eventDescription": "One MetaSleuth wallet-cluster report scraped (funding source + related wallets).",
            "eventPriceUsd": 0.10
          }
        }
      }
    }
  ],
  "dockerfile": "../Dockerfile"
}
```

- [ ] **Step 7: Create `actors/metasleuth-deep/.actor/input_schema.json`**

```json
{
  "$schema": "https://apify.com/schemas/v1/input.ide.json",
  "title": "RugSleuth metasleuth-deep",
  "type": "object",
  "schemaVersion": 1,
  "properties": {
    "address": {
      "title": "Wallet address",
      "type": "string",
      "description": "Base wallet address (0x-prefixed, 40 hex chars).",
      "editor": "textfield",
      "pattern": "^0x[a-fA-F0-9]{40}$"
    },
    "maxRelated": {
      "title": "Max related wallets",
      "type": "integer",
      "description": "Cap on related wallets returned.",
      "default": 20,
      "minimum": 1,
      "maximum": 100
    }
  },
  "required": ["address"]
}
```

- [ ] **Step 8: Create `actors/metasleuth-deep/.actor/output_schema.json`**

```json
{
  "$schema": "https://apify.com/schemas/v1/output.ide.json",
  "actorOutputSchemaVersion": 1,
  "title": "Output schema",
  "properties": {
    "results": {
      "type": "string",
      "title": "Results",
      "template": "{{links.apiDefaultDatasetUrl}}/items"
    }
  }
}
```

- [ ] **Step 9: Create `actors/metasleuth-deep/.actor/dataset_schema.json`**

```json
{
  "$schema": "https://apify.com/schemas/v1/dataset.ide.json",
  "actorSpecification": 1,
  "fields": {},
  "views": {
    "overview": {
      "title": "Overview",
      "transformation": { "fields": ["address", "fundingSource", "clusterSize"] },
      "display": {
        "component": "table",
        "properties": {
          "address": { "label": "Address", "format": "text" },
          "fundingSource": { "label": "Funding source", "format": "object" },
          "clusterSize": { "label": "Cluster size", "format": "number" }
        }
      }
    }
  }
}
```

- [ ] **Step 10: Create `actors/metasleuth-deep/.actor/pricing_schema.json`**

```json
{
  "$schema": "https://apify.com/schemas/v1/pricing.ide.json",
  "pricingModel": "PAY_PER_EVENT",
  "events": {
    "cluster-fetched": {
      "title": "Cluster fetched",
      "description": "One MetaSleuth wallet-cluster report scraped.",
      "priceUsd": 0.10
    }
  }
}
```

- [ ] **Step 11: Install dependencies and verify scaffolding**

From the repo root:
```bash
npm install --workspaces=false --prefix actors/metasleuth-deep
```

Then verify:
```bash
node -e "JSON.parse(require('fs').readFileSync('actors/metasleuth-deep/.actor/actor.json'))" \
  && echo OK
```

Expected: `OK`.

- [ ] **Step 12: Commit**

```bash
git add actors/metasleuth-deep
git commit -m "feat(metasleuth-deep): scaffold Apify Actor (config + Dockerfile, no logic yet)"
```

---

## Task 11: `metasleuth-deep` route handler

**Files:**
- Create: `actors/metasleuth-deep/src/main.ts`
- Create: `actors/metasleuth-deep/src/routes.ts`
- Create: `actors/metasleuth-deep/test/main.test.ts`

- [ ] **Step 1: Write the failing test**

Create `actors/metasleuth-deep/test/main.test.ts`:

```ts
import { PlaywrightCrawler, purgeDefaultStorages } from '@crawlee/playwright';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Actor } from 'apify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { router } from '../src/routes.js';

describe('metasleuth-deep PlaywrightCrawler', () => {
  const address = '0xc1fcc4300305a415a7ea894f71a0694e9f7831d3';
  let server: Server;
  let url: string;

  beforeAll(async () => {
    await purgeDefaultStorages();
    vi.spyOn(Actor, 'charge').mockResolvedValue(undefined as never);

    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`
        <!doctype html>
        <html><body>
          <div data-testid="funding-source">Binance Hot Wallet (cex)</div>
          <ul data-testid="related-wallets">
            <li data-relationship="funded_by" data-tx-count="3">
              <a href="/address/0x9999999999999999999999999999999999999999">0x9999</a>
            </li>
            <li data-relationship="cluster_peer" data-tx-count="1">
              <a href="/address/0x8888888888888888888888888888888888888888">0x8888</a>
            </li>
          </ul>
        </body></html>
      `);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;
    url = `http://127.0.0.1:${port}/result/base/${address}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    vi.restoreAllMocks();
  });

  it('extracts funding source and related wallets, charges cluster-fetched', async () => {
    const crawler = new PlaywrightCrawler({ maxRequestsPerCrawl: 1, requestHandler: router });
    await crawler.run([{ url, userData: { address, maxRelated: 20 } }]);

    const { items } = await crawler.getData();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      address,
      fundingSource: { kind: 'cex', label: expect.stringContaining('Binance') },
      relatedWallets: [
        expect.objectContaining({
          address: '0x9999999999999999999999999999999999999999',
          relationship: 'funded_by',
          txCount: 3,
        }),
        expect.objectContaining({
          address: '0x8888888888888888888888888888888888888888',
          relationship: 'cluster_peer',
          txCount: 1,
        }),
      ],
      signals: expect.objectContaining({ clusterSize: 2 }),
    });
    expect(Actor.charge).toHaveBeenCalledWith({ eventName: 'cluster-fetched' });
  }, 60_000);

  it('degrades gracefully when the page has no cluster data', async () => {
    const fallbackServer = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body><p>nothing to see</p></body></html>');
    });
    await new Promise<void>((resolve) => {
      fallbackServer.listen(0, '127.0.0.1', resolve);
    });
    const { port } = fallbackServer.address() as AddressInfo;
    const fbUrl = `http://127.0.0.1:${port}/result/base/${address}`;

    try {
      const crawler = new PlaywrightCrawler({ maxRequestsPerCrawl: 1, requestHandler: router });
      await crawler.run([{ url: fbUrl, userData: { address, maxRelated: 20 } }]);
      const { items } = await crawler.getData();
      expect(items[items.length - 1]).toMatchObject({
        address,
        fundingSource: null,
        relatedWallets: [],
        signals: { funderIsMixer: false, funderIsKnownScammer: false, clusterSize: 0 },
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        fallbackServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
  }, 60_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd actors/metasleuth-deep && npx vitest run
```

Expected: FAIL — routes module doesn't exist.

- [ ] **Step 3: Implement `actors/metasleuth-deep/src/main.ts`**

```ts
import { PlaywrightCrawler } from '@crawlee/playwright';
import { Actor } from 'apify';

import { router } from './routes.js';

interface Input {
  address: string;
  maxRelated?: number;
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

await Actor.init();

const input = (await Actor.getInput<Input>()) ?? ({} as Input);
const address = input.address?.trim();
const maxRelated = input.maxRelated ?? 20;

if (!address || !ADDRESS_RE.test(address)) {
  await Actor.fail('Invalid address: expected 0x-prefixed 40 hex characters.');
}

const url = `https://metasleuth.io/result/base/${address}`;

const proxyConfiguration = await Actor.createProxyConfiguration({ checkAccess: false });

const crawler = new PlaywrightCrawler({
  proxyConfiguration,
  maxRequestsPerCrawl: 1,
  requestHandler: router,
  launchContext: {
    launchOptions: { args: ['--disable-gpu'] },
  },
});

await crawler.run([{ url, userData: { address, maxRelated } }]);

await Actor.exit();
```

- [ ] **Step 4: Implement `actors/metasleuth-deep/src/routes.ts`**

```ts
import { createPlaywrightRouter } from '@crawlee/playwright';
import { Actor } from 'apify';

export const router = createPlaywrightRouter();

interface UserData {
  address?: string;
  maxRelated?: number;
}

type FundingKind = 'cex' | 'mixer' | 'bridge' | 'eoa' | 'unknown';

const KNOWN_MIXER_LABELS = [/tornado/i, /mixer/i, /sinbad/i];
const KNOWN_BRIDGE_LABELS = [/bridge/i, /wormhole/i, /layerzero/i];
const KNOWN_CEX_LABELS = [/binance/i, /coinbase/i, /kraken/i, /okx/i, /bybit/i];

function classifyLabel(label: string): FundingKind {
  if (KNOWN_MIXER_LABELS.some((re) => re.test(label))) return 'mixer';
  if (KNOWN_BRIDGE_LABELS.some((re) => re.test(label))) return 'bridge';
  if (KNOWN_CEX_LABELS.some((re) => re.test(label))) return 'cex';
  if (/cex/i.test(label)) return 'cex';
  return 'unknown';
}

router.addDefaultHandler(async ({ request, page, log, pushData }) => {
  const data = (request.userData ?? {}) as UserData;
  const address = data.address ?? '';
  const maxRelated = data.maxRelated ?? 20;

  log.info(`Scraping MetaSleuth cluster`, { url: request.loadedUrl, address });

  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  let fundingSource: { kind: FundingKind; label: string | null } | null = null;
  try {
    const node = page.locator('[data-testid="funding-source"]').first();
    if (await node.count() > 0) {
      const text = (await node.innerText()).trim();
      if (text) fundingSource = { kind: classifyLabel(text), label: text };
    }
  } catch (err) {
    log.warning(`Could not extract funding source: ${String(err)}`);
  }

  const relatedWallets: Array<{ address: string; relationship: 'funded_by' | 'funds' | 'cluster_peer'; txCount: number }> = [];
  try {
    const lis = page.locator('[data-testid="related-wallets"] li');
    const count = Math.min(await lis.count(), maxRelated);
    for (let i = 0; i < count; i += 1) {
      const li = lis.nth(i);
      const rel = (await li.getAttribute('data-relationship')) ?? '';
      const txCount = Number((await li.getAttribute('data-tx-count')) ?? '0') || 0;
      const link = li.locator('a[href*="/address/0x"]').first();
      const href = (await link.getAttribute('href')) ?? '';
      const addr = (href.match(/0x[a-fA-F0-9]{40}/) ?? [''])[0];
      if (!addr) continue;
      const relationship: 'funded_by' | 'funds' | 'cluster_peer' =
        rel === 'funded_by' || rel === 'funds' ? rel : 'cluster_peer';
      relatedWallets.push({ address: addr, relationship, txCount });
    }
  } catch (err) {
    log.warning(`Could not extract related wallets: ${String(err)}`);
  }

  const funderIsMixer = fundingSource?.kind === 'mixer';
  const funderIsKnownScammer = false; // requires cross-reference; left for a future enrichment

  await pushData({
    address,
    url: request.loadedUrl,
    fundingSource,
    relatedWallets,
    signals: {
      funderIsMixer,
      funderIsKnownScammer,
      clusterSize: relatedWallets.length,
    },
    scrapedAt: new Date().toISOString(),
  });
  await Actor.charge({ eventName: 'cluster-fetched' });
});
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd actors/metasleuth-deep && npx vitest run
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add actors/metasleuth-deep/src actors/metasleuth-deep/test
git commit -m "feat(metasleuth-deep): route handler extracting funding source + related wallets"
```

---

## Task 12: `analyze_wallet_cluster` tool

**Files:**
- Create: `services/rugcheck-mcp/src/tools/analyze-wallet-cluster.ts`
- Test: `services/rugcheck-mcp/test/analyze-wallet-cluster.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/rugcheck-mcp/test/analyze-wallet-cluster.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { analyzeWalletCluster } from '../src/tools/analyze-wallet-cluster.js';

describe('analyze_wallet_cluster', () => {
  it('returns parsed dataset and forwards payments', async () => {
    const actorClient = {
      runActor: vi.fn().mockResolvedValue({
        result: [
          {
            address: '0xabc',
            fundingSource: { kind: 'mixer', label: 'Tornado Cash 1 ETH' },
            relatedWallets: [
              { address: '0x9999999999999999999999999999999999999999', relationship: 'funded_by', txCount: 2 },
            ],
            signals: { funderIsMixer: true, funderIsKnownScammer: false, clusterSize: 1 },
            scrapedAt: '2026-05-10T00:00:00Z',
          },
        ],
        payments: [
          {
            id: 'p1',
            status: 'settled' as const,
            amountUsdc: '0.10',
            payTo: '0xbee',
            ppeEvent: 'cluster-fetched',
            ts: '2026-05-10T00:00:00Z',
          },
        ],
      }),
    };

    const out = await analyzeWalletCluster({
      address: '0xabc',
      actorClient,
      actorId: 'team/metasleuth-deep',
    });

    expect(actorClient.runActor).toHaveBeenCalledWith({
      actorId: 'team/metasleuth-deep',
      input: { address: '0xabc', maxRelated: 20 },
    });
    expect(out.fundingSource?.kind).toBe('mixer');
    expect(out.relatedWallets).toHaveLength(1);
    expect(out.signals.funderIsMixer).toBe(true);
    expect(out.payments).toHaveLength(1);
  });

  it('returns minimum-shape result on Actor failure', async () => {
    const actorClient = { runActor: vi.fn().mockRejectedValue(new Error('boom')) };
    const out = await analyzeWalletCluster({
      address: '0xabc',
      actorClient,
      actorId: 'team/metasleuth-deep',
    });
    expect(out).toEqual({
      address: '0xabc',
      fundingSource: null,
      relatedWallets: [],
      signals: { funderIsMixer: false, funderIsKnownScammer: false, clusterSize: 0 },
      payments: [],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run services/rugcheck-mcp/test/analyze-wallet-cluster.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tool**

Create `services/rugcheck-mcp/src/tools/analyze-wallet-cluster.ts`:

```ts
// services/rugcheck-mcp/src/tools/analyze-wallet-cluster.ts
import type { PaymentEvent } from '@rugsleuth/x402-client';
import type { ApifyActorClient } from '../apify-client.js';
import { emit } from '../events.js';

export type FundingKind = 'cex' | 'mixer' | 'bridge' | 'eoa' | 'unknown';

export interface RelatedWallet {
  address: string;
  relationship: 'funded_by' | 'funds' | 'cluster_peer';
  txCount: number;
}

export interface ClusterSignals {
  funderIsMixer: boolean;
  funderIsKnownScammer: boolean;
  clusterSize: number;
}

export interface AnalyzeWalletClusterInput {
  address: string;
  actorClient: ApifyActorClient;
  actorId: string;
  maxRelated?: number;
}

export interface AnalyzeWalletClusterOutput {
  address: string;
  fundingSource: { kind: FundingKind; label: string | null } | null;
  relatedWallets: RelatedWallet[];
  signals: ClusterSignals;
  payments: PaymentEvent[];
}

type RawDataset = Array<{
  address?: string;
  fundingSource?: AnalyzeWalletClusterOutput['fundingSource'];
  relatedWallets?: RelatedWallet[];
  signals?: ClusterSignals;
}>;

export async function analyzeWalletCluster(
  input: AnalyzeWalletClusterInput,
): Promise<AnalyzeWalletClusterOutput> {
  const tool = 'analyze_wallet_cluster';
  const start = Date.now();
  const maxRelated = input.maxRelated ?? 20;
  emit({ kind: 'tool.start', tool, args: { address: input.address, maxRelated } });

  const empty: AnalyzeWalletClusterOutput = {
    address: input.address,
    fundingSource: null,
    relatedWallets: [],
    signals: { funderIsMixer: false, funderIsKnownScammer: false, clusterSize: 0 },
    payments: [],
  };

  try {
    const res = await input.actorClient.runActor<RawDataset>({
      actorId: input.actorId,
      input: { address: input.address, maxRelated },
    });

    for (const p of res.payments) {
      emit({
        kind: 'payment',
        tool,
        status: p.status,
        amountUsdc: p.amountUsdc,
        payTo: p.payTo,
        ppeEvent: p.ppeEvent,
        error: p.error,
      });
    }

    const item = res.result[0];
    if (!item) {
      emit({ kind: 'tool.end', tool, ok: true, ms: Date.now() - start });
      return { ...empty, payments: res.payments };
    }

    emit({ kind: 'tool.end', tool, ok: true, ms: Date.now() - start });
    return {
      address: item.address ?? input.address,
      fundingSource: item.fundingSource ?? null,
      relatedWallets: item.relatedWallets ?? [],
      signals: item.signals ?? empty.signals,
      payments: res.payments,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ kind: 'tool.end', tool, ok: false, error: message, ms: Date.now() - start });
    return empty;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run services/rugcheck-mcp/test/analyze-wallet-cluster.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add services/rugcheck-mcp/src/tools/analyze-wallet-cluster.ts services/rugcheck-mcp/test/analyze-wallet-cluster.test.ts
git commit -m "feat(rugcheck-mcp): analyze_wallet_cluster tool driving metasleuth-deep"
```

---

## Task 13: Register all four tools in the MCP server (with `withCache`)

**Files:**
- Modify: `services/rugcheck-mcp/src/index.ts`

- [ ] **Step 1: Replace the contents of `services/rugcheck-mcp/src/index.ts`**

```ts
#!/usr/bin/env node
// services/rugcheck-mcp/src/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createX402Client } from '@rugsleuth/x402-client';
import { createApifyActorClient } from './apify-client.js';
import { scrapeBasescanAddress } from './tools/scrape-basescan-address.js';
import { scrapeXMentions } from './tools/scrape-x-mentions.js';
import { listDeployerContracts } from './tools/list-deployer-contracts.js';
import { analyzeWalletCluster } from './tools/analyze-wallet-cluster.js';
import { checkScamBlacklists } from './tools/check-scam-blacklists.js';
import { withCache } from './tools/with-cache.js';
import { WalletCache } from './wallet-cache.js';
import { fetchGoPlusFlags } from './blacklists/goplus.js';
import { createScamSnifferChecker } from './blacklists/scam-sniffer.js';

const baseEnv = z.object({
  APIFY_PAYMENT_MODE: z.enum(['token', 'x402']).default('x402'),
  APIFY_BASE_URL: z.string().url().default('https://api.apify.com'),
  BASESCAN_DEEP_ACTOR_ID: z.string().min(1),
  X_SCRAPER_ACTOR_ID: z.string().min(1).default('apidojo/twitter-scraper-lite'),
  METASLEUTH_DEEP_ACTOR_ID: z.string().min(1).default('rugsleuth/metasleuth-deep'),
  GOPLUS_CHAIN_ID: z.coerce.number().default(8453),
  APIFY_TOKEN: z.string().optional(),
  WALLET_PRIVATE_KEY: z.string().optional(),
});

const env = baseEnv.parse(process.env);

const actorClient =
  env.APIFY_PAYMENT_MODE === 'token'
    ? createApifyActorClient({
        mode: 'token',
        apifyBaseUrl: env.APIFY_BASE_URL,
        apifyToken: z
          .string()
          .min(1, 'APIFY_TOKEN is required when APIFY_PAYMENT_MODE=token')
          .parse(env.APIFY_TOKEN),
      })
    : createApifyActorClient({
        mode: 'x402',
        apifyBaseUrl: env.APIFY_BASE_URL,
        x402Client: createX402Client({
          privateKey: z
            .string()
            .regex(
              /^0x[a-fA-F0-9]{64}$/,
              'WALLET_PRIVATE_KEY must be a 0x-prefixed 64-hex-char string',
            )
            .parse(env.WALLET_PRIVATE_KEY) as `0x${string}`,
        }),
      });

const cache = new WalletCache();
const scamSnifferCheck = createScamSnifferChecker();

const TTL = {
  scrape_x_mentions: 6 * 60 * 60 * 1000,
  list_deployer_contracts: 1 * 60 * 60 * 1000,
  check_scam_blacklists: 24 * 60 * 60 * 1000,
  analyze_wallet_cluster: 24 * 60 * 60 * 1000,
} as const;

const ADDRESS_SCHEMA = {
  type: 'object',
  properties: { address: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' } },
  required: ['address'],
} as const;

const callXMentions = withCache(
  (i: { address: string }) =>
    scrapeXMentions({
      address: i.address,
      actorClient,
      actorId: env.X_SCRAPER_ACTOR_ID,
      linkedHandle: null,
    }),
  { tool: 'scrape_x_mentions', ttlMs: TTL.scrape_x_mentions, cache },
);

const callListDeployer = withCache(
  (i: { address: string }) =>
    listDeployerContracts({
      address: i.address,
      actorClient,
      actorId: env.BASESCAN_DEEP_ACTOR_ID,
    }),
  { tool: 'list_deployer_contracts', ttlMs: TTL.list_deployer_contracts, cache },
);

const callCheckBlacklists = withCache(
  (i: { address: string }) =>
    checkScamBlacklists({
      address: i.address,
      goPlus: ({ address }) =>
        fetchGoPlusFlags({ address, chainId: env.GOPLUS_CHAIN_ID }),
      scamSnifferCheck,
    }),
  { tool: 'check_scam_blacklists', ttlMs: TTL.check_scam_blacklists, cache },
);

const callAnalyzeCluster = withCache(
  (i: { address: string }) =>
    analyzeWalletCluster({
      address: i.address,
      actorClient,
      actorId: env.METASLEUTH_DEEP_ACTOR_ID,
    }),
  { tool: 'analyze_wallet_cluster', ttlMs: TTL.analyze_wallet_cluster, cache },
);

const server = new Server(
  { name: 'rugcheck-mcp', version: '0.2.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'scrape_basescan_address',
      description:
        'Fetches BaseScan data for a Base contract or wallet address (balance, contract status, recent txs). Costs USDC via x402.',
      inputSchema: ADDRESS_SCHEMA,
    },
    {
      name: 'scrape_x_mentions',
      description:
        'Searches X (Twitter) for tweets that paste this wallet address as a literal string. Returns raw tweets so the caller can reason over text. Costs USDC via x402.',
      inputSchema: ADDRESS_SCHEMA,
    },
    {
      name: 'list_deployer_contracts',
      description:
        "Lists every contract this wallet has deployed on Base, with verification status and basic risk signals (serial-deployer, unverified ratio, age). Costs USDC via x402.",
      inputSchema: ADDRESS_SCHEMA,
    },
    {
      name: 'check_scam_blacklists',
      description:
        'Checks the wallet against free public blacklists (GoPlus address_security + ScamSniffer). Free, no payment. Returns hit list and a clean flag.',
      inputSchema: ADDRESS_SCHEMA,
    },
    {
      name: 'analyze_wallet_cluster',
      description:
        'Returns funding-source classification (CEX / mixer / bridge / EOA) and related wallets via MetaSleuth. Costs USDC via x402.',
      inputSchema: ADDRESS_SCHEMA,
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = z
    .object({ address: z.string().regex(/^0x[a-fA-F0-9]{40}$/) })
    .parse(req.params.arguments);

  let result: unknown;
  switch (req.params.name) {
    case 'scrape_basescan_address':
      result = await scrapeBasescanAddress({
        address: args.address,
        actorClient,
        actorId: env.BASESCAN_DEEP_ACTOR_ID,
      });
      break;
    case 'scrape_x_mentions':
      result = await callXMentions({ address: args.address });
      break;
    case 'list_deployer_contracts':
      result = await callListDeployer({ address: args.address });
      break;
    case 'check_scam_blacklists':
      result = await callCheckBlacklists({ address: args.address });
      break;
    case 'analyze_wallet_cluster':
      result = await callAnalyzeCluster({ address: args.address });
      break;
    default:
      throw new Error(`Unknown tool: ${req.params.name}`);
  }

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 2: Build the package**

```bash
npm --workspace services/rugcheck-mcp run build
```

Expected: PASS, no type errors.

- [ ] **Step 3: Run the full rugcheck-mcp test suite**

```bash
npx vitest run services/rugcheck-mcp/test
```

Expected: PASS — all suites (existing `scrape_basescan_address` + 7 new files).

- [ ] **Step 4: Commit**

```bash
git add services/rugcheck-mcp/src/index.ts
git commit -m "feat(rugcheck-mcp): register four new wallet-research tools through WalletCache"
```

---

## Task 14: Extend `scripts/e2e-mock.sh` with the new tool fixtures

**Files:**
- Modify: `scripts/e2e-mock.sh`
- Modify: `scripts/fake-codex.mjs` (so the fake Codex calls the new tools)

- [ ] **Step 1: Read the existing fake-codex script to understand its interface**

```bash
cat scripts/fake-codex.mjs
```

Expected: short Node script that emits MCP-style tool-call traffic.

- [ ] **Step 2: Modify `scripts/fake-codex.mjs`**

Find the section that issues a single `scrape_basescan_address` call and add four more sequential calls — one per new tool — using the same pattern. Each call should emit the same line shape the fake currently emits for `scrape_basescan_address` but with the new tool name. Use this template (insert near where the existing call is constructed; preserve everything else verbatim):

```js
const NEW_TOOLS = [
  'scrape_x_mentions',
  'list_deployer_contracts',
  'check_scam_blacklists',
  'analyze_wallet_cluster',
];
for (const t of NEW_TOOLS) {
  await callTool(t, { address });   // reuse whatever helper the file already defines
}
```

If `scripts/fake-codex.mjs` doesn't already abstract tool-calling into a helper, do **not** refactor it in this task — instead, copy whatever block currently calls `scrape_basescan_address` four times, each time substituting the tool name.

- [ ] **Step 3: Modify `scripts/e2e-mock.sh`**

In the section that builds the mock x402 server `resultBody`, replace the single-array body with a routing-style mock so each new tool's input shape returns sane fixture data. The simplest path is to keep the *same* `resultBody` (mock server doesn't need different bodies per Actor for our smoke test) and instead extend the **assertion** at the bottom of the script:

Find:
```bash
grep -q '"type":"mcp.event".*"status":"settled"' "$EVENTS_FILE"
```

After it, add:
```bash
for tool in scrape_x_mentions list_deployer_contracts check_scam_blacklists analyze_wallet_cluster; do
  grep -q "\"kind\":\"tool.start\".*\"tool\":\"$tool\"" "$EVENTS_FILE"
  grep -q "\"kind\":\"tool.end\".*\"tool\":\"$tool\"" "$EVENTS_FILE"
done
```

This forces the smoke test to fail unless every new tool fired both `tool.start` and `tool.end` over the SSE stream.

Also extend the env-var block (around line 53-58) to inject the new Actor IDs the MCP server expects. Add these lines after `BASESCAN_DEEP_ACTOR_ID=team/basescan-deep \\`:

```bash
X_SCRAPER_ACTOR_ID=team/x-scraper \
METASLEUTH_DEEP_ACTOR_ID=team/metasleuth-deep \
```

- [ ] **Step 4: Run the smoke test**

```bash
bash scripts/e2e-mock.sh
```

Expected: script exits 0 with all `grep -q` assertions satisfied.

- [ ] **Step 5: Commit**

```bash
git add scripts/e2e-mock.sh scripts/fake-codex.mjs
git commit -m "test(e2e): smoke-test all five MCP tools end-to-end"
```

---

## Task 15: (Optional) Render `cached` pill in dashboard

This task is optional in v1 per the spec (Section 8 / open question 3). Skip if pressed for time.

**Files:**
- Modify: `apps/dashboard/lib/useInvestigation.ts` (event-shape only)
- Modify: `apps/dashboard/components/AgentWalletCard.tsx` or wherever tool events render in the timeline

- [ ] **Step 1: Update the SSE event type in `apps/dashboard/lib/useInvestigation.ts`**

Find the `tool.end` payload type and add `cached?: boolean`. Keep unrelated code unchanged.

- [ ] **Step 2: In the timeline rendering component, when a `tool.end` event has `cached: true`, render a small pill labelled "cached"** (Tailwind class suggestion: `inline-flex items-center px-1.5 py-0.5 text-xs rounded bg-amber-100 text-amber-800`).

- [ ] **Step 3: Manual verify**

```bash
npm --workspace apps/dashboard run dev
# In another terminal: trigger an investigation twice for the same address
# and confirm the second run renders the "cached" pill on each tool card.
```

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard
git commit -m "feat(dashboard): show 'cached' pill on cached tool.end events"
```

---

## Self-review

**Spec coverage:**
- Section 1 (goal/scope) → covered by tasks 1-14 collectively.
- Section 2 (architecture) → tasks 13 (registration) + 14 (smoke).
- Section 3.1 `scrape_x_mentions` → Task 7.
- Section 3.2 `list_deployer_contracts` + new PPE event → Tasks 8 + 9.
- Section 3.3 `check_scam_blacklists` → Tasks 4 + 5 + 6.
- Section 3.4 `analyze_wallet_cluster` + metasleuth-deep Actor → Tasks 10, 11, 12.
- Section 4 (cache) → Tasks 1 + 3 (`withCache` adapter applies it).
- Section 5 (events / cached field) → Task 2.
- Section 6 (error handling) → soft-fail tested in Tasks 6, 7, 9, 11, 12.
- Section 7 (testing) → unit tests in Tasks 1, 3-7, 9, 11, 12; Actor test in Task 11; integration smoke in Task 14.
- Section 8 (cached pill optional) → Task 15.

**Placeholder scan:** none — every task has full code blocks for the files it touches and concrete commands. The MetaSleuth route handler test uses fixture HTML the route's selectors match exactly (`[data-testid="funding-source"]`, `[data-testid="related-wallets"] li[data-relationship][data-tx-count]`); when the real Actor runs against the live SPA, the selectors will need to be re-pointed at the actual DOM, but the route + test contract is concrete.

**Type consistency:** `PaymentEvent` from `@rugsleuth/x402-client` is consistent across all four tools. `cached?: boolean` added in both `services/rugcheck-mcp/src/events.ts` and `services/orchestrator/src/events.ts` (Task 2). Tool names match between the `withCache` registration (Task 13), the MCP server's `name` field (Task 13), and the e2e assertions (Task 14).

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-10-wallet-research-sources.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

**Which approach?**
