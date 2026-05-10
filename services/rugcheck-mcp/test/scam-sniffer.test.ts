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
