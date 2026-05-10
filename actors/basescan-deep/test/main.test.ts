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

describe('deployer-history route', () => {
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
        <html><body>
          <h1>Address Overview</h1>
          <span>First Tx: 2025-01-01</span>
          <table id="ContractsCreated" class="table">
            <tbody>
              <tr>
                <td><a href="/address/0x1111111111111111111111111111111111111111">0x1111…1111</a></td>
                <td>Verified</td>
                <td>MyToken</td>
                <td>2025-02-01</td>
                <td>120 holders</td>
              </tr>
              <tr>
                <td><a href="/address/0x2222222222222222222222222222222222222222">0x2222…2222</a></td>
                <td>Unverified</td>
                <td></td>
                <td>2025-04-15</td>
                <td>2 holders</td>
              </tr>
            </tbody>
          </table>
        </body></html>
      `);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;
    url = `http://127.0.0.1:${port}/address/${address}#contractscreated`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    vi.restoreAllMocks();
  });

  it('extracts deployer contract list and charges deployer-history-fetched', async () => {
    const crawler = new PlaywrightCrawler({ maxRequestsPerCrawl: 1, requestHandler: router });
    await crawler.run([
      { url, userData: { address, mode: 'deployer-history' as const } },
    ]);

    const { items } = await crawler.getData();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      address,
      mode: 'deployer-history',
      totalContractsDeployed: 2,
      contracts: [
        expect.objectContaining({
          contractAddress: '0x1111111111111111111111111111111111111111',
          isVerified: true,
          name: 'MyToken',
          holderCount: 120,
          suspicious: false,
        }),
        expect.objectContaining({
          contractAddress: '0x2222222222222222222222222222222222222222',
          isVerified: false,
          holderCount: 2,
          suspicious: true,
        }),
      ],
    });
    expect(Actor.charge).toHaveBeenCalledWith({ eventName: 'deployer-history-fetched' });
  }, 60_000);
});
