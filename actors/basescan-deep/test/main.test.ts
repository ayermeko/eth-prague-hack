import { PlaywrightCrawler, purgeDefaultStorages } from '@crawlee/playwright';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Actor } from 'apify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { router } from '../src/routes.js';

describe('PlaywrightCrawler', () => {
    const address = '0xc1fcc4300305a415a7ea894f71a0694e9f7831d3';
    let server: Server;
    let url: string;

    beforeAll(async () => {
        await purgeDefaultStorages();
        vi.spyOn(Actor, 'charge').mockResolvedValue(undefined as never);

        server = createServer((_req, res) => {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(`
                <!doctype html>
                <html>
                    <head><title>BaseScan Address Mock</title></head>
                    <body>
                        <div class="card">ETH Balance 0.5 ETH</div>
                        <a href="#code">Contract</a>
                        <span>Contract Source Code Verified</span>
                        <table class="table">
                            <tbody>
                                <tr><td>mock-tx-1</td><td>Transfer</td></tr>
                            </tbody>
                        </table>
                    </body>
                </html>
            `);
        });

        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', resolve);
        });
        const { port } = server.address() as AddressInfo;
        url = `http://127.0.0.1:${port}/address/${address}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        });
        vi.restoreAllMocks();
    });

    it('should crawl and push data to dataset', async () => {
        const crawler = new PlaywrightCrawler({
            maxRequestsPerCrawl: 1,
            requestHandler: router,
        });

        await crawler.run([{ url, userData: { address } }]);

        expect(crawler.stats.state.requestsFinished).toBe(1);

        const { items } = await crawler.getData();
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            address,
            title: 'BaseScan Address Mock',
            ethBalance: 'ETH Balance 0.5 ETH',
            isContract: true,
            verified: true,
            latestTxs: ['mock-tx-1\tTransfer'],
        });
        expect(items[0].url).toBe(url);
        expect(items[0].scrapedAt).toEqual(expect.any(String));
        expect(Actor.charge).toHaveBeenCalledWith({ eventName: 'address-fetched' });
    }, 60_000);
});
