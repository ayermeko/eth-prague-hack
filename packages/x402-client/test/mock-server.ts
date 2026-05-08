// packages/x402-client/test/mock-server.ts
//
// Mock x402 v2 server. Emits a base64-encoded `payment-required` header with
// the `exact` scheme so the client exercises the same code path it will hit
// against Apify in production.
import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { AddressInfo } from 'node:net';

export interface MockBehavior {
  // Paths that always return 200 with `resultBody`, even without X402 header.
  alwaysFree?: string[];
  // Network in CAIP-2 form (default Base mainnet).
  network?: string;
  // ERC-20 contract — defaults to USDC on Base.
  asset?: string;
  // Amount in token base units (USDC: 6 decimals; default = 1 USDC = "1000000").
  amount?: string;
  // Recipient.
  payTo?: string;
  // Result body returned on a settled 200.
  resultBody?: unknown;
  // Reject every signed retry (for failure-path tests).
  rejectSignatures?: boolean;
}

export interface MockServerHandle {
  url: string;
  close: () => Promise<void>;
  callsByPath: Record<string, number>;
  prepaidByCaller: Record<string, number>;
}

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

export async function startMockServer(behavior: MockBehavior = {}): Promise<MockServerHandle> {
  const callsByPath: Record<string, number> = {};
  const prepaidByCaller: Record<string, number> = {};
  const network = behavior.network ?? 'eip155:8453';
  const asset = behavior.asset ?? USDC_BASE;
  const amount = behavior.amount ?? '1000000';
  const payTo = behavior.payTo ?? '0x0000000000000000000000000000000000000bee';
  const resultBody = behavior.resultBody ?? { ok: true };

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    callsByPath[url] = (callsByPath[url] ?? 0) + 1;

    const isFree = behavior.alwaysFree?.includes(url) ?? false;
    if (isFree) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resultBody));
      return;
    }

    const protocolHeader = req.headers['x-apify-payment-protocol'];
    const signature = req.headers['payment-signature'];
    const callerKey = (req.headers['x-test-caller'] as string) ?? 'default';

    if (!protocolHeader || protocolHeader !== 'X402') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'X402 header required' }));
      return;
    }

    if ((prepaidByCaller[callerKey] ?? 0) > 0) {
      prepaidByCaller[callerKey] = (prepaidByCaller[callerKey] ?? 0) - 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resultBody));
      return;
    }

    if (!signature) {
      const challenge = {
        x402Version: 2,
        error: 'PAYMENT-SIGNATURE header is required.',
        resource: { description: 'Mock x402 v2 endpoint', mimeType: 'application/json' },
        accepts: [
          {
            scheme: 'exact',
            network,
            asset,
            amount,
            payTo,
            maxTimeoutSeconds: 60,
            extra: { name: 'USD Coin', version: '2' },
          },
        ],
      };
      const headerValue = Buffer.from(JSON.stringify(challenge), 'utf8').toString('base64');
      res.writeHead(402, {
        'Content-Type': 'application/json',
        'payment-required': headerValue,
      });
      res.end(JSON.stringify({ error: 'Payment required' }));
      return;
    }

    if (behavior.rejectSignatures) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad signature' }));
      return;
    }

    prepaidByCaller[callerKey] = (prepaidByCaller[callerKey] ?? 0) + 5;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(resultBody));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
    callsByPath,
    prepaidByCaller,
  };
}
