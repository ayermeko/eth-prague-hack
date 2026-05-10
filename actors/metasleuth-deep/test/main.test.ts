import { PlaywrightCrawler, purgeDefaultStorages } from '@crawlee/playwright';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Actor } from 'apify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { router } from '../src/routes.js';

describe('metasleuth-deep PlaywrightCrawler', () => {
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
          <div data-testid="funding-source">Binance Hot Wallet (cex)</div>
          <ul data-testid="related-wallets">
            <li data-relationship="funded_by" data-tx-count="3">
              <a href="/address/0x9999999999999999999999999999999999999999">0x9999</a>
            </li>
            <li data-relationship="cluster_peer" data-tx-count="1">
              <a href="/address/0x8888888888888888888888888888888888888888">0x8888</a>
            </li>
          </ul>
        </body></html>
      `);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;
    url = `http://127.0.0.1:${port}/result/base/${address}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    vi.restoreAllMocks();
  });

  it('extracts funding source and related wallets, charges cluster-fetched', async () => {
    const crawler = new PlaywrightCrawler({ maxRequestsPerCrawl: 1, requestHandler: router });
    await crawler.run([{ url, userData: { address, maxRelated: 20 } }]);

    const { items } = await crawler.getData();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      address,
      fundingSource: { kind: 'cex', label: expect.stringContaining('Binance') },
      relatedWallets: [
        expect.objectContaining({
          address: '0x9999999999999999999999999999999999999999',
          relationship: 'funded_by',
          txCount: 3,
        }),
        expect.objectContaining({
          address: '0x8888888888888888888888888888888888888888',
          relationship: 'cluster_peer',
          txCount: 1,
        }),
      ],
      signals: expect.objectContaining({ clusterSize: 2 }),
    });
    expect(Actor.charge).toHaveBeenCalledWith({ eventName: 'cluster-fetched' });
  }, 60_000);

  it('degrades gracefully when the page has no cluster data', async () => {
    await purgeDefaultStorages();
    const fallbackServer = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body><p>nothing to see</p></body></html>');
    });
    await new Promise<void>((resolve) => {
      fallbackServer.listen(0, '127.0.0.1', resolve);
    });
    const { port } = fallbackServer.address() as AddressInfo;
    const fbUrl = `http://127.0.0.1:${port}/result/base/${address}`;

    try {
      const crawler = new PlaywrightCrawler({ maxRequestsPerCrawl: 1, requestHandler: router });
      await crawler.run([{ url: fbUrl, userData: { address, maxRelated: 20 } }]);
      const { items } = await crawler.getData();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        address,
        fundingSource: null,
        relatedWallets: [],
        signals: { funderIsMixer: false, funderIsKnownScammer: false, clusterSize: 0 },
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        fallbackServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
  }, 60_000);
});
