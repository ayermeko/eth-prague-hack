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
