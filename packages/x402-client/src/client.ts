import type {
  PaymentEvent,
  PaymentListener,
  X402ClientOptions,
  X402Request,
  X402Response,
} from './types.js';
import {
  encodePaymentPayload,
  formatUsdc,
  parseChallenge,
  pickExactOption,
  signChallenge,
} from './signing.js';

export interface X402Client {
  fetch<T = unknown>(req: X402Request): Promise<X402Response<T>>;
  on(event: 'payment', listener: PaymentListener): void;
}

const PAYMENT_PROTOCOL = 'X402';
const HEADER_PROTOCOL = 'X-APIFY-PAYMENT-PROTOCOL';
const HEADER_SIGNATURE = 'PAYMENT-SIGNATURE';
const HEADER_REQUIRED = 'payment-required';

export function createX402Client(opts: X402ClientOptions): X402Client {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const now = opts.now ?? (() => new Date());
  const randomId = opts.randomId ?? (() => Math.random().toString(36).slice(2));
  const listeners: PaymentListener[] = [];

  function emit(events: PaymentEvent[], event: PaymentEvent): void {
    events.push(event);
    for (const l of listeners) l(event);
  }

  async function send(req: X402Request, signature?: string): Promise<Response> {
    const headers: Record<string, string> = {
      [HEADER_PROTOCOL]: PAYMENT_PROTOCOL,
      'Content-Type': 'application/json',
      ...(req.headers ?? {}),
    };
    if (signature) headers[HEADER_SIGNATURE] = signature;
    return fetchImpl(req.url, {
      method: req.method ?? 'GET',
      headers,
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
    });
  }

  async function readJson<T>(response: Response): Promise<T> {
    return (await response.json()) as T;
  }

  return {
    on(_event, listener) {
      listeners.push(listener);
    },

    async fetch<T>(req: X402Request): Promise<X402Response<T>> {
      const payments: PaymentEvent[] = [];
      const first = await send(req);

      if (first.status === 200) {
        return { result: await readJson<T>(first), payments };
      }

      if (first.status !== 402) {
        throw new Error(`x402-client: unexpected status ${first.status}`);
      }

      const requiredHeader = first.headers.get(HEADER_REQUIRED);
      if (!requiredHeader) {
        throw new Error('x402-client: 402 without payment-required header');
      }

      // Drain the 402 body (avoids socket-leak warnings on some runtimes).
      await first.text().catch(() => undefined);

      const challenge = parseChallenge(requiredHeader);
      const option = pickExactOption(challenge);
      const amountUsdc = formatUsdc(option.amount);

      const requiredEvent: PaymentEvent = {
        id: randomId(),
        status: 'required',
        amountUsdc,
        payTo: option.payTo,
        ppeEvent: option.network,
        ts: now().toISOString(),
      };
      emit(payments, requiredEvent);

      let signature: string;
      try {
        const signed = await signChallenge(opts.privateKey, challenge);
        signature = encodePaymentPayload(signed);
      } catch (err) {
        const failed: PaymentEvent = {
          ...requiredEvent,
          id: randomId(),
          status: 'failed',
          ts: now().toISOString(),
          error: err instanceof Error ? err.message : String(err),
        };
        emit(payments, failed);
        throw err;
      }

      emit(payments, {
        ...requiredEvent,
        id: randomId(),
        status: 'signed',
        ts: now().toISOString(),
      });

      const second = await send(req, signature);
      if (second.status !== 200) {
        const errBody = await second.text().catch(() => '');
        const failed: PaymentEvent = {
          ...requiredEvent,
          id: randomId(),
          status: 'failed',
          ts: now().toISOString(),
          error: `Resend returned ${second.status}${errBody ? `: ${errBody.slice(0, 240)}` : ''}`,
        };
        emit(payments, failed);
        throw new Error(`x402-client: resend returned ${second.status}`);
      }

      emit(payments, {
        ...requiredEvent,
        id: randomId(),
        status: 'settled',
        ts: now().toISOString(),
      });

      return { result: await readJson<T>(second), payments };
    },
  };
}
