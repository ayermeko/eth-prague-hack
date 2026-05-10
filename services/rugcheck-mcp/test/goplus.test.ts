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
