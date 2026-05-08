import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createX402Client } from '../src/index.js';
import { startMockServer, MockServerHandle } from './mock-server.js';

const TEST_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const; // anvil #0

describe('x402-client', () => {
  let mock: MockServerHandle;

  beforeEach(async () => {
    mock = await startMockServer({ alwaysFree: ['/free'] });
  });

  afterEach(async () => {
    await mock.close();
  });

  it('passes through on a 200 response with no payment', async () => {
    const client = createX402Client({ privateKey: TEST_KEY });
    const res = await client.fetch({ url: `${mock.url}/free` });

    expect(res.payments).toEqual([]);
    expect(res.result).toEqual({ ok: true });
  });

  it('handles 402 by signing the challenge and resending', async () => {
    const client = createX402Client({ privateKey: TEST_KEY });
    const res = await client.fetch({ url: `${mock.url}/scrape` });

    expect(res.result).toEqual({ ok: true });
    expect(res.payments.length).toBe(3);
    expect(res.payments.map((p) => p.status)).toEqual(['required', 'signed', 'settled']);
    expect(res.payments[0]!.amountUsdc).toBe('1.000000');
  });

  it('reuses prepaid balance: only the first call signs', async () => {
    const client = createX402Client({ privateKey: TEST_KEY });

    const first = await client.fetch({ url: `${mock.url}/scrape`, headers: { 'X-Test-Caller': 'a' } });
    const second = await client.fetch({ url: `${mock.url}/scrape`, headers: { 'X-Test-Caller': 'a' } });

    expect(first.payments.map((p) => p.status)).toEqual(['required', 'signed', 'settled']);
    expect(second.payments).toEqual([]); // pure prepaid drawdown
    expect(second.result).toEqual({ ok: true });
  });

  it('emits payment.failed when the resigned request is rejected', async () => {
    const rejectingMock = await startMockServer({ rejectSignatures: true });
    try {
      const client = createX402Client({ privateKey: TEST_KEY });
      let captured: { status: string; error?: string } | null = null;
      client.on('payment', (e) => {
        if (e.status === 'failed') captured = { status: e.status, error: e.error };
      });

      await expect(client.fetch({ url: `${rejectingMock.url}/scrape` })).rejects.toThrow();
      expect(captured).not.toBeNull();
      expect(captured!.status).toBe('failed');
    } finally {
      await rejectingMock.close();
    }
  });
});
