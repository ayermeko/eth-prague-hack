import { Actor } from 'apify';
import { createPlaywrightRouter } from '@crawlee/playwright';

export const router = createPlaywrightRouter();

router.addDefaultHandler(async ({ request, page, log, pushData }) => {
  const address = (request.userData as { address?: string }).address ?? '';
  log.info(`Scraping BaseScan address page`, { url: request.loadedUrl, address });

  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  const title = await page.title();

  let ethBalance: string | null = null;
  try {
    const card = page.locator('div.card').filter({ hasText: 'ETH Balance' }).first();
    if (await card.isVisible()) {
      ethBalance = (await card.innerText()).trim();
    }
  } catch (err) {
    log.warning(`Could not extract ETH balance: ${String(err)}`);
  }

  const isContract =
    (await page.locator('a[href*="#code"]:has-text("Contract")').count()) > 0;

  const verified =
    (await page
      .locator('span:has-text("Contract Source Code Verified")')
      .count()) > 0;

  const txRowsRaw: string[] = [];
  try {
    const rows = page.locator('table.table tbody tr');
    const count = Math.min(await rows.count(), 5);
    for (let i = 0; i < count; i += 1) {
      txRowsRaw.push((await rows.nth(i).innerText()).trim());
    }
  } catch (err) {
    log.warning(`Could not extract transactions: ${String(err)}`);
  }

  const item = {
    address,
    url: request.loadedUrl,
    title,
    ethBalance,
    isContract,
    verified,
    latestTxs: txRowsRaw,
    scrapedAt: new Date().toISOString(),
  };

  await pushData(item);
  // Emit the PPE billing event exactly once per successful scrape.
  await Actor.charge({ eventName: 'address-fetched' });
});
