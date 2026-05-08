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
  privateKey: `0x${string}`;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  randomId?: () => string;
}
