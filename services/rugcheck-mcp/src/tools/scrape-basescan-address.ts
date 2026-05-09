import type { PaymentEvent } from '@rugsleuth/x402-client';
import type { ApifyActorClient } from '../apify-client.js';
import { emit } from '../events.js';

export interface ScrapeBasescanAddressInput {
  address: string;
  actorClient: ApifyActorClient;
  actorId: string;
}

export interface ScrapeBasescanAddressOutput {
  address: string;
  ethBalance: string | null;
  isContract: boolean;
  verified: boolean;
  latestTxs: string[];
  scrapedAt: string;
  payments: PaymentEvent[];
}

type ApifyDatasetItems = Array<{
  address?: string;
  ethBalance?: string | null;
  isContract?: boolean;
  verified?: boolean;
  latestTxs?: string[];
  latestTransactions?: string[];
  scrapedAt?: string;
}>;

export async function scrapeBasescanAddress(
  input: ScrapeBasescanAddressInput,
): Promise<ScrapeBasescanAddressOutput> {
  const { address, actorClient, actorId } = input;
  const tool = 'scrape_basescan_address';
  const start = Date.now();
  emit({ kind: 'tool.start', tool, args: { address } });

  try {
    const res = await actorClient.runActor<ApifyDatasetItems>({
      actorId,
      input: { address },
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
    if (!item) throw new Error('Actor returned no dataset items');

    const out: ScrapeBasescanAddressOutput = {
      address: item.address ?? address,
      ethBalance: item.ethBalance ?? null,
      isContract: item.isContract ?? false,
      verified: item.verified ?? false,
      latestTxs: item.latestTxs ?? item.latestTransactions ?? [],
      scrapedAt: item.scrapedAt ?? new Date().toISOString(),
      payments: res.payments,
    };

    emit({ kind: 'tool.end', tool, ok: true, ms: Date.now() - start });
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ kind: 'tool.end', tool, ok: false, error: message, ms: Date.now() - start });
    throw err;
  }
}
