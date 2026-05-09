import { describe, expect, it, vi } from 'vitest';
import { createApifyActorClient, type ActorRunRequest } from '../src/apify-client.js';

const request: ActorRunRequest = {
  actorId: 'user/basescan-deep',
  input: { address: '0x1111111111111111111111111111111111111111' },
};

describe('createApifyActorClient', () => {
  it('runs an Actor with APIFY_TOKEN in token mode', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        'https://api.apify.com/v2/acts/user%2Fbasescan-deep/run-sync-get-dataset-items?token=apify_api_test',
      );
      expect(init?.method).toBe('POST');
      expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(init?.body).toBe(JSON.stringify(request.input));
      return new Response(JSON.stringify([{ ok: true }]), { status: 200 });
    });

    const client = createApifyActorClient({
      mode: 'token',
      apifyBaseUrl: 'https://api.apify.com',
      apifyToken: 'apify_api_test',
      fetch,
    });

    await expect(client.runActor(request)).resolves.toEqual({
      result: [{ ok: true }],
      payments: [],
    });
  });

  it('throws a useful error for token mode HTTP failures', async () => {
    const fetch = vi.fn(async () => new Response('bad actor input', { status: 400 }));
    const client = createApifyActorClient({
      mode: 'token',
      apifyBaseUrl: 'https://api.apify.com',
      apifyToken: 'apify_api_test',
      fetch,
    });

    await expect(client.runActor(request)).rejects.toThrow(
      'Apify token Actor call failed with 400: bad actor input',
    );
  });

  it('delegates to x402 client in x402 mode', async () => {
    const x402Client = {
      on: vi.fn(),
      fetch: vi.fn(async () => ({
        result: [{ paid: true }],
        payments: [
          {
            status: 'settled' as const,
            amountUsdc: '1.000000',
            payTo: '0x2222222222222222222222222222222222222222',
            ts: '2026-05-09T00:00:00.000Z',
          },
        ],
      })),
    };

    const client = createApifyActorClient({
      mode: 'x402',
      apifyBaseUrl: 'https://api.apify.com',
      x402Client,
    });

    const result = await client.runActor(request);

    expect(result.result).toEqual([{ paid: true }]);
    expect(result.payments).toHaveLength(1);
    expect(x402Client.fetch).toHaveBeenCalledWith({
      url: 'https://api.apify.com/v2/acts/user%2Fbasescan-deep/run-sync-get-dataset-items',
      method: 'POST',
      body: request.input,
    });
  });
});
