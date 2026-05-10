import { createPlaywrightRouter } from '@crawlee/playwright';
import { Actor } from 'apify';

export const router = createPlaywrightRouter();

interface UserData {
  address?: string;
  maxRelated?: number;
}

type FundingKind = 'cex' | 'mixer' | 'bridge' | 'eoa' | 'unknown';

const KNOWN_MIXER_LABELS = [/tornado/i, /mixer/i, /sinbad/i];
const KNOWN_BRIDGE_LABELS = [/bridge/i, /wormhole/i, /layerzero/i];
const KNOWN_CEX_LABELS = [/binance/i, /coinbase/i, /kraken/i, /okx/i, /bybit/i];

function classifyLabel(label: string): FundingKind {
  if (KNOWN_MIXER_LABELS.some((re) => re.test(label))) return 'mixer';
  if (KNOWN_BRIDGE_LABELS.some((re) => re.test(label))) return 'bridge';
  if (KNOWN_CEX_LABELS.some((re) => re.test(label))) return 'cex';
  if (/cex/i.test(label)) return 'cex';
  return 'unknown';
}

router.addDefaultHandler(async ({ request, page, log, pushData }) => {
  const data = (request.userData ?? {}) as UserData;
  const address = data.address ?? '';
  const maxRelated = data.maxRelated ?? 20;

  log.info(`Scraping MetaSleuth cluster`, { url: request.loadedUrl, address });

  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  let fundingSource: { kind: FundingKind; label: string | null } | null = null;
  try {
    const node = page.locator('[data-testid="funding-source"]').first();
    if ((await node.count()) > 0) {
      const text = (await node.innerText()).trim();
      if (text) fundingSource = { kind: classifyLabel(text), label: text };
    }
  } catch (err) {
    log.warning(`Could not extract funding source: ${String(err)}`);
  }

  const relatedWallets: Array<{
    address: string;
    relationship: 'funded_by' | 'funds' | 'cluster_peer';
    txCount: number;
  }> = [];
  try {
    const lis = page.locator('[data-testid="related-wallets"] li');
    const count = Math.min(await lis.count(), maxRelated);
    for (let i = 0; i < count; i += 1) {
      const li = lis.nth(i);
      const rel = (await li.getAttribute('data-relationship')) ?? '';
      const txCount = Number((await li.getAttribute('data-tx-count')) ?? '0') || 0;
      const link = li.locator('a[href*="/address/0x"]').first();
      const href = (await link.getAttribute('href')) ?? '';
      const addr = (href.match(/0x[a-fA-F0-9]{40}/) ?? [''])[0];
      if (!addr) continue;
      const relationship: 'funded_by' | 'funds' | 'cluster_peer' =
        rel === 'funded_by' || rel === 'funds' ? rel : 'cluster_peer';
      relatedWallets.push({ address: addr, relationship, txCount });
    }
  } catch (err) {
    log.warning(`Could not extract related wallets: ${String(err)}`);
  }

  const funderIsMixer = fundingSource?.kind === 'mixer';
  const funderIsKnownScammer = false;

  await pushData({
    address,
    url: request.loadedUrl,
    fundingSource,
    relatedWallets,
    signals: {
      funderIsMixer,
      funderIsKnownScammer,
      clusterSize: relatedWallets.length,
    },
    scrapedAt: new Date().toISOString(),
  });
  await Actor.charge({ eventName: 'cluster-fetched' });
});
