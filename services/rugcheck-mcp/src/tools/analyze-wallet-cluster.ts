// services/rugcheck-mcp/src/tools/analyze-wallet-cluster.ts
import type { PaymentEvent } from '@rugsleuth/x402-client';
import type { ApifyActorClient } from '../apify-client.js';
import { emit } from '../events.js';

export type FundingKind = 'cex' | 'mixer' | 'bridge' | 'eoa' | 'unknown';

export interface RelatedWallet {
  address: string;
  relationship: 'funded_by' | 'funds' | 'cluster_peer';
  txCount: number;
}

export interface ClusterSignals {
  funderIsMixer: boolean;
  funderIsKnownScammer: boolean;
  clusterSize: number;
}

export interface AnalyzeWalletClusterInput {
  address: string;
  actorClient: ApifyActorClient;
  actorId: string;
  maxRelated?: number;
}

export interface AnalyzeWalletClusterOutput {
  address: string;
  fundingSource: { kind: FundingKind; label: string | null } | null;
  relatedWallets: RelatedWallet[];
  signals: ClusterSignals;
  payments: PaymentEvent[];
}

type RawDataset = Array<{
  address?: string;
  fundingSource?: AnalyzeWalletClusterOutput['fundingSource'];
  relatedWallets?: RelatedWallet[];
  signals?: ClusterSignals;
}>;

export async function analyzeWalletCluster(
  input: AnalyzeWalletClusterInput,
): Promise<AnalyzeWalletClusterOutput> {
  const tool = 'analyze_wallet_cluster';
  const start = Date.now();
  const maxRelated = input.maxRelated ?? 20;
  emit({ kind: 'tool.start', tool, args: { address: input.address, maxRelated } });

  const empty: AnalyzeWalletClusterOutput = {
    address: input.address,
    fundingSource: null,
    relatedWallets: [],
    signals: { funderIsMixer: false, funderIsKnownScammer: false, clusterSize: 0 },
    payments: [],
  };

  try {
    const res = await input.actorClient.runActor<RawDataset>({
      actorId: input.actorId,
      input: { address: input.address, maxRelated },
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
      fundingSource: item.fundingSource ?? null,
      relatedWallets: item.relatedWallets ?? [],
      signals: item.signals ?? empty.signals,
      payments: res.payments,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ kind: 'tool.end', tool, ok: false, error: message, ms: Date.now() - start });
    return empty;
  }
}
