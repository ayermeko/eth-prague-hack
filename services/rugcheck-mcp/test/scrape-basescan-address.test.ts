// services/rugcheck-mcp/test/scrape-basescan-address.test.ts
import { describe, expect, it, vi } from 'vitest';
import { scrapeBasescanAddress } from '../src/tools/scrape-basescan-address.js';

describe('scrape_basescan_address', () => {
  it('returns a compact summary and forwards x402 payments', async () => {
    const actorClient = {
      runActor: vi.fn().mockResolvedValue({
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
      actorClient,
      actorId: 'team/basescan-deep',
    });

    expect(out.address).toBe('0xc1fcc4300305a415a7ea894f71a0694e9f7831d3');
    expect(out.isContract).toBe(true);
    expect(out.verified).toBe(false);
    expect(out.payments.length).toBe(1);
    expect(actorClient.runActor).toHaveBeenCalledWith({
      actorId: 'team/basescan-deep',
      input: { address: '0xc1fcc4300305a415a7ea894f71a0694e9f7831d3' },
    });
  });

  it('normalizes the older deployed Actor output shape', async () => {
    const actorClient = {
      runActor: vi.fn().mockResolvedValue({
        result: [
          {
            url: 'https://basescan.org/address/0x1BD831237695a48F3FB4413FaedD77482371dF61',
            title: 'Address: 0x1BD831...2371dF61 | BaseScan',
            ethBalance: 'Overview\nETH BALANCE\n0 ETH\nETH VALUE\n$0.00',
            latestTransactions: ['tx-a'],
            scrapedAt: '2026-05-09T21:10:01.216Z',
          },
        ],
        payments: [],
      }),
    };

    const out = await scrapeBasescanAddress({
      address: '0x1BD831237695a48F3FB4413FaedD77482371dF61',
      actorClient,
      actorId: 'team/basescan-deep',
    });

    expect(out.address).toBe('0x1BD831237695a48F3FB4413FaedD77482371dF61');
    expect(out.ethBalance).toContain('ETH BALANCE');
    expect(out.isContract).toBe(false);
    expect(out.verified).toBe(false);
    expect(out.latestTxs).toEqual(['tx-a']);
  });
});
