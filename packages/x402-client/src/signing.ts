import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

export interface PaymentChallenge {
  scheme: 'eip712';
  chainId: number;
  verifyingContract: Hex;
  amountUsdc: string;
  payTo: Hex;
  ppeEvent: string;
  nonce: string;
  validUntil: string;
}

export interface SigningResult {
  signature: Hex;
  challenge: PaymentChallenge;
}

export function parseChallenge(headerValue: string): PaymentChallenge {
  const parsed = JSON.parse(headerValue) as PaymentChallenge;
  if (parsed.scheme !== 'eip712') {
    throw new Error(`Unsupported x402 scheme: ${String(parsed.scheme)}`);
  }
  return parsed;
}

export async function signChallenge(privateKey: Hex, challenge: PaymentChallenge): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);

  const domain = {
    name: 'Apify x402',
    version: '1',
    chainId: challenge.chainId,
    verifyingContract: challenge.verifyingContract,
  } as const;

  const types = {
    Payment: [
      { name: 'amountUsdc', type: 'string' },
      { name: 'payTo', type: 'address' },
      { name: 'ppeEvent', type: 'string' },
      { name: 'nonce', type: 'string' },
      { name: 'validUntil', type: 'string' },
    ],
  } as const;

  return account.signTypedData({
    domain,
    types,
    primaryType: 'Payment',
    message: {
      amountUsdc: challenge.amountUsdc,
      payTo: challenge.payTo,
      ppeEvent: challenge.ppeEvent,
      nonce: challenge.nonce,
      validUntil: challenge.validUntil,
    },
  });
}
