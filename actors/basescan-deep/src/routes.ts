import { createPlaywrightRouter } from '@crawlee/playwright';

export const router = createPlaywrightRouter();

router.addDefaultHandler(async ({ request, page, log, pushData }) => {
    log.info(`Scraping BaseScan URL:`, { url: request.loadedUrl });
    const title = await page.title();

    // Give the page a moment to load dynamic contents
    await page.waitForTimeout(2000);

    // Extract basic information like balance
    let ethBalance = null;
    let latestTransactions = [];

    try {
        // Try to find the section with ETH Balance
        const balanceCard = page.locator('div.card').filter({ hasText: 'ETH Balance' }).first();
        if (await balanceCard.isVisible()) {
            ethBalance = await balanceCard.innerText();
        }
    } catch (e) {
        log.warning(`Could not extract ETH Balance: ${e}`);
    }

    try {
        // Try to get some transaction rows from the primary table
        const rowLocators = page.locator('table.table tbody tr').locator('nth=0,1,2,3,4');
        const count = await rowLocators.count();
        for (let i = 0; i < count; i++) {
            latestTransactions.push(await rowLocators.nth(i).innerText());
        }
    } catch (e) {
        log.warning(`Could not extract transactions: ${e}`);
    }

    await pushData({
        url: request.loadedUrl,
        title,
        ethBalance,
        latestTransactions,
        scrapedAt: new Date().toISOString()
    });
});
