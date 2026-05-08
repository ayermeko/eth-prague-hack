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
import { scrapeBasescanAddress } from './tools/scrape-basescan-address.js';

const env = z
  .object({
    WALLET_PRIVATE_KEY: z
      .string()
      .regex(/^0x[a-fA-F0-9]{64}$/, 'WALLET_PRIVATE_KEY must be a 0x-prefixed 64-hex-char string'),
    APIFY_BASE_URL: z.string().url().default('https://api.apify.com'),
    BASESCAN_DEEP_ACTOR_ID: z.string().min(1),
  })
  .parse(process.env);

const client = createX402Client({ privateKey: env.WALLET_PRIVATE_KEY as `0x${string}` });

const server = new Server(
  { name: 'rugcheck-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

const SCRAPE_INPUT = {
  type: 'object',
  properties: {
    address: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
  },
  required: ['address'],
} as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'scrape_basescan_address',
      description:
        'Fetches BaseScan data for a Base contract or wallet address (balance, contract status, recent txs). Costs USDC via x402.',
      inputSchema: SCRAPE_INPUT,
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'scrape_basescan_address') {
    throw new Error(`Unknown tool: ${req.params.name}`);
  }
  const args = z
    .object({ address: z.string().regex(/^0x[a-fA-F0-9]{40}$/) })
    .parse(req.params.arguments);

  const result = await scrapeBasescanAddress({
    address: args.address,
    client,
    apifyBaseUrl: env.APIFY_BASE_URL,
    actorId: env.BASESCAN_DEEP_ACTOR_ID,
  });

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
