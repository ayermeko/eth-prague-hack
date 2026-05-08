// packages/x402-client/test/mock-server.ts
import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { AddressInfo } from 'node:net';

export interface MockBehavior {
  // First call to a path: respond with 402; subsequent calls: 200
  // unless `alwaysFree` includes the path.
  alwaysFree?: string[];
  // PPE event name to advertise in 402 response
  ppeEvent?: string;
  // amount in USDC decimal string
  amountUsdc?: string;
  // pay-to recipient address
  payTo?: string;
  // result body to return on settled 200
  resultBody?: unknown;
  // force every call to fail signing verification (for error tests)
  rejectSignatures?: boolean;
}

export interface MockServerHandle {
  url: string;
  close: () => Promise<void>;
  callsByPath: Record<string, number>;
  prepaidByCaller: Record<string, number>;
}

export async function startMockServer(behavior: MockBehavior = {}): Promise<MockServerHandle> {
  const callsByPath: Record<string, number> = {};
  const prepaidByCaller: Record<string, number> = {};
  const ppeEvent = behavior.ppeEvent ?? 'address-fetched';
  const amountUsdc = behavior.amountUsdc ?? '0.05';
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

    // Drawdown if prepaid balance exists
    if ((prepaidByCaller[callerKey] ?? 0) > 0) {
      prepaidByCaller[callerKey] = (prepaidByCaller[callerKey] ?? 0) - 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resultBody));
      return;
    }

    // No signature → emit 402
    if (!signature) {
      const required = JSON.stringify({
        scheme: 'eip712',
        chainId: 8453,
        verifyingContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        amountUsdc,
        payTo,
        ppeEvent,
        nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        validUntil: new Date(Date.now() + 60_000).toISOString(),
      });
      res.writeHead(402, {
        'Content-Type': 'application/json',
        'PAYMENT-REQUIRED': required,
      });
      res.end(JSON.stringify({ error: 'Payment required' }));
      return;
    }

    // Signature provided
    if (behavior.rejectSignatures) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad signature' }));
      return;
    }

    // Top up prepaid (5 free calls per signed payment to mirror Apify model)
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
