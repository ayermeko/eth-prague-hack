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
