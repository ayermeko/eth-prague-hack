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
