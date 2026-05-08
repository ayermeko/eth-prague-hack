// services/orchestrator/test/validation.test.ts
import { describe, expect, it } from 'vitest';
import { parseAddress } from '../src/validation.js';

describe('parseAddress', () => {
  it('accepts a 0x-prefixed 40-hex address', () => {
    const a = '0xc1fcc4300305a415a7ea894f71a0694e9f7831d3';
    expect(parseAddress(a)).toBe(a);
  });

  it('lowercases mixed-case input', () => {
    const a = '0xC1FCC4300305A415A7Ea894F71a0694E9F7831D3';
    expect(parseAddress(a)).toBe(a.toLowerCase());
  });

  it('rejects bad input', () => {
    expect(() => parseAddress('0x123')).toThrow();
    expect(() => parseAddress('not-an-address')).toThrow();
    expect(() => parseAddress('')).toThrow();
  });
});
