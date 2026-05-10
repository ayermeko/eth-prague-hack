import { createPlaywrightRouter } from '@crawlee/playwright';
import { Actor } from 'apify';

export const router = createPlaywrightRouter();

interface UserData {
  address?: string;
  mode?: 'address' | 'deployer-history';
}

router.addDefaultHandler(async ({ request, page, log, pushData }) => {
  const data = (request.userData ?? {}) as UserData;
  const address = data.address ?? '';
  const mode = data.mode ?? 'address';

  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  if (mode === 'deployer-history') {
    log.info(`Scraping BaseScan deployer history`, { url: request.loadedUrl, address });

    const rows = page.locator('table#ContractsCreated tbody tr, table.table tbody tr');
    const rowCount = Math.min(await rows.count(), 25);
    const contracts: Array<{
      contractAddress: string;
      deployedAt: string;
      isVerified: boolean;
      name: string | null;
      holderCount: number | null;
      suspicious: boolean;
    }> = [];

    for (let i = 0; i < rowCount; i += 1) {
      const row = rows.nth(i);
      const link = row.locator('a[href*="/address/0x"]').first();
      const href = (await link.getAttribute('href')) ?? '';
      const contractAddress = (href.match(/0x[a-fA-F0-9]{40}/) ?? [''])[0];
      if (!contractAddress) continue;

      const cells = row.locator('td');
      const cellCount = await cells.count();
      const cellTexts: string[] = [];
      for (let c = 0; c < cellCount; c += 1) {
        cellTexts.push((await cells.nth(c).innerText()).trim());
      }

      const isVerified = cellTexts.some((t) => /^verified$/i.test(t));
      const nameCellIdx = cellTexts.findIndex((t) => /^[A-Za-z][A-Za-z0-9 _-]{0,40}$/.test(t) && !/Verified|Unverified/i.test(t));
      const name = nameCellIdx >= 0 ? cellTexts[nameCellIdx] : null;
      const dateMatch = cellTexts.find((t) => /\d{4}-\d{2}-\d{2}/.test(t)) ?? '';
      const holderMatch = (cellTexts.find((t) => /\d+\s+holders/i.test(t)) ?? '').match(/(\d+)/);
      const holderCount = holderMatch ? Number(holderMatch[1]) : null;

      contracts.push({
        contractAddress,
        deployedAt: (dateMatch.match(/\d{4}-\d{2}-\d{2}/) ?? [''])[0],
        isVerified,
        name,
        holderCount,
        suspicious: !isVerified && (holderCount === null || holderCount < 10),
      });
    }

    const firstTxText = (await page.locator('text=/First Tx/i').first().innerText().catch(() => '')) ?? '';
    const firstTxDateMatch = firstTxText.match(/\d{4}-\d{2}-\d{2}/);
    const deployerAgeDays = firstTxDateMatch
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - Date.parse(firstTxDateMatch[0])) / (24 * 60 * 60 * 1000),
          ),
        )
      : 0;

    const recent = contracts.filter((c) => {
      if (!c.deployedAt) return false;
      const ts = Date.parse(c.deployedAt);
      return Number.isFinite(ts) && Date.now() - ts < 30 * 24 * 60 * 60 * 1000;
    });
    const unverified = contracts.filter((c) => !c.isVerified);

    await pushData({
      address,
      mode: 'deployer-history',
      url: request.loadedUrl,
      totalContractsDeployed: contracts.length,
      contracts,
      signals: {
        deployerAgeDays,
        serialDeployer: recent.length > 5,
        unverifiedRatio: contracts.length === 0 ? 0 : unverified.length / contracts.length,
      },
      scrapedAt: new Date().toISOString(),
    });
    await Actor.charge({ eventName: 'deployer-history-fetched' });
    return;
  }

  log.info(`Scraping BaseScan address page`, { url: request.loadedUrl, address });

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

  await pushData({
    address,
    mode: 'address',
    url: request.loadedUrl,
    title,
    ethBalance,
    isContract,
    verified,
    latestTxs: txRowsRaw,
    scrapedAt: new Date().toISOString(),
  });
  await Actor.charge({ eventName: 'address-fetched' });
});
