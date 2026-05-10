// services/rugcheck-mcp/src/tools/list-deployer-contracts.ts
import type { PaymentEvent } from '@rugsleuth/x402-client';
import type { ApifyActorClient } from '../apify-client.js';
import { emit } from '../events.js';

export interface DeployedContract {
  contractAddress: string;
  deployedAt: string;
  isVerified: boolean;
  name: string | null;
  holderCount: number | null;
  suspicious: boolean;
}

export interface DeployerSignals {
  deployerAgeDays: number;
  serialDeployer: boolean;
  unverifiedRatio: number;
}

export interface ListDeployerContractsInput {
  address: string;
  actorClient: ApifyActorClient;
  actorId: string;
}

export interface ListDeployerContractsOutput {
  address: string;
  totalContractsDeployed: number;
  contracts: DeployedContract[];
  signals: DeployerSignals;
  payments: PaymentEvent[];
}

type RawDataset = Array<{
  address?: string;
  totalContractsDeployed?: number;
  contracts?: DeployedContract[];
  signals?: DeployerSignals;
}>;

export async function listDeployerContracts(
  input: ListDeployerContractsInput,
): Promise<ListDeployerContractsOutput> {
  const tool = 'list_deployer_contracts';
  const start = Date.now();
  emit({ kind: 'tool.start', tool, args: { address: input.address } });

  const empty: ListDeployerContractsOutput = {
    address: input.address,
    totalContractsDeployed: 0,
    contracts: [],
    signals: { deployerAgeDays: 0, serialDeployer: false, unverifiedRatio: 0 },
    payments: [],
  };

  try {
    const res = await input.actorClient.runActor<RawDataset>({
      actorId: input.actorId,
      input: { address: input.address, mode: 'deployer-history' },
    });

    for (const p of res.payments) {
      emit({
        kind: 'payment',
        tool,
        status: p.status,
        amountUsdc: p.amountUsdc,
        payTo: p.payTo,
        ppeEvent: p.ppeEvent,
        error: p.error,
      });
    }

    const item = res.result[0];
    if (!item) {
      emit({ kind: 'tool.end', tool, ok: true, ms: Date.now() - start });
      return { ...empty, payments: res.payments };
    }

    emit({ kind: 'tool.end', tool, ok: true, ms: Date.now() - start });
    return {
      address: item.address ?? input.address,
      totalContractsDeployed: item.totalContractsDeployed ?? 0,
      contracts: item.contracts ?? [],
      signals: item.signals ?? empty.signals,
      payments: res.payments,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ kind: 'tool.end', tool, ok: false, error: message, ms: Date.now() - start });
    return empty;
  }
}
