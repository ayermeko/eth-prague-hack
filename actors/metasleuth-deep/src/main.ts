import { PlaywrightCrawler } from '@crawlee/playwright';
import { Actor } from 'apify';

import { router } from './routes.js';

interface Input {
  address: string;
  maxRelated?: number;
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

await Actor.init();

const input = (await Actor.getInput<Input>()) ?? ({} as Input);
const address = input.address?.trim();
const maxRelated = input.maxRelated ?? 20;

if (!address || !ADDRESS_RE.test(address)) {
  await Actor.fail('Invalid address: expected 0x-prefixed 40 hex characters.');
}

const url = `https://metasleuth.io/result/base/${address}`;

const proxyConfiguration = await Actor.createProxyConfiguration({ checkAccess: false });

const crawler = new PlaywrightCrawler({
  proxyConfiguration,
  maxRequestsPerCrawl: 1,
  requestHandler: router,
  launchContext: {
    launchOptions: { args: ['--disable-gpu'] },
  },
});

await crawler.run([{ url, userData: { address, maxRelated } }]);

await Actor.exit();
