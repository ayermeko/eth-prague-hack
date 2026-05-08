import type { X402Client, X402Response, PaymentEvent } from '@rugsleuth/x402-client';
import { emit } from '../events.js';

export interface ScrapeBasescanAddressInput {
  address: string;
  client: X402Client;
  apifyBaseUrl: string;
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

interface ApifyRunResponse {
  data: {
    items: Array<{
      address: string;
      ethBalance: string | null;
      isContract: boolean;
      verified: boolean;
      latestTxs: string[];
      scrapedAt: string;
    }>;
  };
}

export async function scrapeBasescanAddress(
  input: ScrapeBasescanAddressInput,
): Promise<ScrapeBasescanAddressOutput> {
  const { address, client, apifyBaseUrl, actorId } = input;
  const tool = 'scrape_basescan_address';
  const start = Date.now();
  emit({ kind: 'tool.start', tool, args: { address } });

  const url = `${apifyBaseUrl}/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items`;

  try {
    const res = (await client.fetch({
      url,
      method: 'POST',
      body: { address },
    })) as X402Response<ApifyRunResponse>;

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

    const item = res.result.data.items[0];
    if (!item) throw new Error('Actor returned no dataset items');

    const out: ScrapeBasescanAddressOutput = {
      address: item.address,
      ethBalance: item.ethBalance,
      isContract: item.isContract,
      verified: item.verified,
      latestTxs: item.latestTxs,
      scrapedAt: item.scrapedAt,
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
