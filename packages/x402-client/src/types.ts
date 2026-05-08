export type PaymentStatus = 'required' | 'signed' | 'settled' | 'failed';

export interface PaymentEvent {
  id: string;
  status: PaymentStatus;
  amountUsdc: string;
  payTo: string;
  ppeEvent?: string;
  prepaidRef?: string;
  txHash?: string;
  ts: string;
  error?: string;
}

export interface X402Request {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
}

export interface X402Response<T = unknown> {
  result: T;
  payments: PaymentEvent[];
}

export type PaymentListener = (event: PaymentEvent) => void;

export interface X402ClientOptions {
  // Required only when no `sign` override is provided. With `sign`, the wallet
  // can live entirely outside the process (e.g. in mcpc's keychain).
  privateKey?: `0x${string}`;
  // Optional override for how challenges get signed. When supplied, replaces
  // the default viem-based EIP-3009 signer with whatever you provide
  // (e.g. `mcpcSign` shells out to the mcpc CLI). Returns a base64-encoded
  // PAYMENT-SIGNATURE header value.
  sign?: (challenge: unknown) => string | Promise<string>;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  randomId?: () => string;
}
