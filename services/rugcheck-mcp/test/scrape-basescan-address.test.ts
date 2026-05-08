// services/rugcheck-mcp/test/scrape-basescan-address.test.ts
import { describe, expect, it, vi } from 'vitest';
import { scrapeBasescanAddress } from '../src/tools/scrape-basescan-address.js';

describe('scrape_basescan_address', () => {
  it('returns a compact summary and forwards x402 payments', async () => {
    const fakeClient = {
      on: vi.fn(),
      fetch: vi.fn().mockResolvedValue({
        result: [
          {
            address: '0xc1fcc4300305a415a7ea894f71a0694e9f7831d3',
            ethBalance: '0.01 ETH',
            isContract: true,
            verified: false,
            latestTxs: ['tx1', 'tx2'],
            scrapedAt: '2026-05-08T12:00:00Z',
          },
        ],
        payments: [
          {
            id: 'p1',
            status: 'settled' as const,
            amountUsdc: '0.05',
            payTo: '0xbee',
            ppeEvent: 'address-fetched',
            ts: '2026-05-08T12:00:00Z',
          },
        ],
      }),
    };

    const out = await scrapeBasescanAddress({
      address: '0xc1fcc4300305a415a7ea894f71a0694e9f7831d3',
      client: fakeClient as never,
      apifyBaseUrl: 'https://api.apify.com',
      actorId: 'team/basescan-deep',
    });

    expect(out.address).toBe('0xc1fcc4300305a415a7ea894f71a0694e9f7831d3');
    expect(out.isContract).toBe(true);
    expect(out.verified).toBe(false);
    expect(out.payments.length).toBe(1);
    expect(fakeClient.fetch).toHaveBeenCalledOnce();
  });
});
