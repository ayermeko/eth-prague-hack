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

  it('throws when ttlMs is zero or negative', () => {
    const c = new WalletCache();
    expect(() => c.set('0xabc', 'tool-a', 'v', 0)).toThrow(/ttlMs must be positive/);
    expect(() => c.set('0xabc', 'tool-a', 'v', -1)).toThrow(/ttlMs must be positive/);
  });
});
