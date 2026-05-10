#!/usr/bin/env node
// services/rugcheck-mcp/src/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createX402Client } from '@rugsleuth/x402-client';
import { createApifyActorClient } from './apify-client.js';
import { scrapeBasescanAddress } from './tools/scrape-basescan-address.js';
import { scrapeXMentions } from './tools/scrape-x-mentions.js';
import { listDeployerContracts } from './tools/list-deployer-contracts.js';
import { analyzeWalletCluster } from './tools/analyze-wallet-cluster.js';
import { checkScamBlacklists } from './tools/check-scam-blacklists.js';
import { withCache } from './tools/with-cache.js';
import { WalletCache } from './wallet-cache.js';
import { fetchGoPlusFlags } from './blacklists/goplus.js';
import { createScamSnifferChecker } from './blacklists/scam-sniffer.js';

const baseEnv = z.object({
  APIFY_PAYMENT_MODE: z.enum(['token', 'x402']).default('x402'),
  APIFY_BASE_URL: z.string().url().default('https://api.apify.com'),
  BASESCAN_DEEP_ACTOR_ID: z.string().min(1),
  X_SCRAPER_ACTOR_ID: z.string().min(1).default('apidojo/twitter-scraper-lite'),
  METASLEUTH_DEEP_ACTOR_ID: z.string().min(1).default('rugsleuth/metasleuth-deep'),
  GOPLUS_CHAIN_ID: z.coerce.number().default(8453),
  APIFY_TOKEN: z.string().optional(),
  WALLET_PRIVATE_KEY: z.string().optional(),
});

const env = baseEnv.parse(process.env);

const actorClient =
  env.APIFY_PAYMENT_MODE === 'token'
    ? createApifyActorClient({
        mode: 'token',
        apifyBaseUrl: env.APIFY_BASE_URL,
        apifyToken: z
          .string()
          .min(1, 'APIFY_TOKEN is required when APIFY_PAYMENT_MODE=token')
          .parse(env.APIFY_TOKEN),
      })
    : createApifyActorClient({
        mode: 'x402',
        apifyBaseUrl: env.APIFY_BASE_URL,
        x402Client: createX402Client({
          privateKey: z
            .string()
            .regex(
              /^0x[a-fA-F0-9]{64}$/,
              'WALLET_PRIVATE_KEY must be a 0x-prefixed 64-hex-char string',
            )
            .parse(env.WALLET_PRIVATE_KEY) as `0x${string}`,
        }),
      });

const cache = new WalletCache();
const scamSnifferCheck = createScamSnifferChecker();

const TTL = {
  scrape_x_mentions: 6 * 60 * 60 * 1000,
  list_deployer_contracts: 1 * 60 * 60 * 1000,
  check_scam_blacklists: 24 * 60 * 60 * 1000,
  analyze_wallet_cluster: 24 * 60 * 60 * 1000,
} as const;

const ADDRESS_SCHEMA = {
  type: 'object',
  properties: { address: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' } },
  required: ['address'],
} as const;

const callXMentions = withCache(
  (i: { address: string }) =>
    scrapeXMentions({
      address: i.address,
      actorClient,
      actorId: env.X_SCRAPER_ACTOR_ID,
      linkedHandle: null,
    }),
  {
    tool: 'scrape_x_mentions',
    ttlMs: TTL.scrape_x_mentions,
    cache,
    shouldCache: (r) =>
      r.payments.length > 0 ||
      r.literalMentions.length > 0 ||
      r.authoredByLinkedHandle.length > 0,
  },
);

const callListDeployer = withCache(
  (i: { address: string }) =>
    listDeployerContracts({
      address: i.address,
      actorClient,
      actorId: env.BASESCAN_DEEP_ACTOR_ID,
    }),
  {
    tool: 'list_deployer_contracts',
    ttlMs: TTL.list_deployer_contracts,
    cache,
    shouldCache: (r) => r.payments.length > 0 || r.totalContractsDeployed > 0,
  },
);

const callCheckBlacklists = withCache(
  (i: { address: string }) =>
    checkScamBlacklists({
      address: i.address,
      goPlus: ({ address }) =>
        fetchGoPlusFlags({ address, chainId: env.GOPLUS_CHAIN_ID }),
      scamSnifferCheck,
    }),
  {
    tool: 'check_scam_blacklists',
    ttlMs: TTL.check_scam_blacklists,
    cache,
    shouldCache: (r) => r.sources.goplus === 'ok' || r.sources.scamsniffer === 'ok',
  },
);

const callAnalyzeCluster = withCache(
  (i: { address: string }) =>
    analyzeWalletCluster({
      address: i.address,
      actorClient,
      actorId: env.METASLEUTH_DEEP_ACTOR_ID,
    }),
  {
    tool: 'analyze_wallet_cluster',
    ttlMs: TTL.analyze_wallet_cluster,
    cache,
    shouldCache: (r) =>
      r.payments.length > 0 ||
      r.fundingSource !== null ||
      r.relatedWallets.length > 0,
  },
);

const server = new Server(
  { name: 'rugcheck-mcp', version: '0.2.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'scrape_basescan_address',
      description:
        'Fetches BaseScan data for a Base contract or wallet address (balance, contract status, recent txs). Costs USDC via x402.',
      inputSchema: ADDRESS_SCHEMA,
    },
    {
      name: 'scrape_x_mentions',
      description:
        'Searches X (Twitter) for tweets that paste this wallet address as a literal string. Returns raw tweets so the caller can reason over text. Costs USDC via x402.',
      inputSchema: ADDRESS_SCHEMA,
    },
    {
      name: 'list_deployer_contracts',
      description:
        "Lists every contract this wallet has deployed on Base, with verification status and basic risk signals (serial-deployer, unverified ratio, age). Costs USDC via x402.",
      inputSchema: ADDRESS_SCHEMA,
    },
    {
      name: 'check_scam_blacklists',
      description:
        'Checks the wallet against free public blacklists (GoPlus address_security + ScamSniffer). Free, no payment. Returns hit list and a clean flag.',
      inputSchema: ADDRESS_SCHEMA,
    },
    {
      name: 'analyze_wallet_cluster',
      description:
        'Returns funding-source classification (CEX / mixer / bridge / EOA) and related wallets via MetaSleuth. Costs USDC via x402.',
      inputSchema: ADDRESS_SCHEMA,
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = z
    .object({ address: z.string().regex(/^0x[a-fA-F0-9]{40}$/) })
    .parse(req.params.arguments);

  let result: unknown;
  switch (req.params.name) {
    case 'scrape_basescan_address':
      result = await scrapeBasescanAddress({
        address: args.address,
        actorClient,
        actorId: env.BASESCAN_DEEP_ACTOR_ID,
      });
      break;
    case 'scrape_x_mentions':
      result = await callXMentions({ address: args.address });
      break;
    case 'list_deployer_contracts':
      result = await callListDeployer({ address: args.address });
      break;
    case 'check_scam_blacklists':
      result = await callCheckBlacklists({ address: args.address });
      break;
    case 'analyze_wallet_cluster':
      result = await callAnalyzeCluster({ address: args.address });
      break;
    default:
      throw new Error(`Unknown tool: ${req.params.name}`);
  }

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
