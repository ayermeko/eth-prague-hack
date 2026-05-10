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
