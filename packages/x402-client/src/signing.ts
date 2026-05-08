// x402 v2, scheme: "exact" (EIP-3009 transferWithAuthorization).
// Per https://x402.org/ and the Apify deployment.
//
// The 402 response carries the challenge in the `payment-required` header as a
// base64-encoded JSON document. The client signs an EIP-3009 authorization for
// the requested amount on the requested chain, wraps the signed payload, and
// sends it back base64-encoded in the `PAYMENT-SIGNATURE` header. The server
// (or its facilitator) submits the authorization on-chain to settle.

import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

export interface X402AcceptOption {
  scheme: 'exact';
  network: string; // e.g. "eip155:8453"
  asset: Hex; // ERC-20 contract (USDC on Base)
  amount: string; // integer in token base units (USDC: 6 decimals)
  payTo: Hex;
  maxTimeoutSeconds: number;
  extra?: { name?: string; version?: string };
}

export interface X402V2Challenge {
  x402Version: 2;
  error?: string;
  resource?: { description?: string; mimeType?: string };
  accepts: X402AcceptOption[];
  extensions?: Record<string, unknown>;
}

export interface X402V2PaymentPayload {
  x402Version: 2;
  scheme: 'exact';
  network: string;
  payload: {
    signature: Hex;
    authorization: {
      from: Hex;
      to: Hex;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: Hex;
    };
  };
}

export interface SignChallengeOptions {
  now?: () => Date;
  randomBytes?: (n: number) => Uint8Array;
}

export function parseChallenge(headerValue: string): X402V2Challenge {
  const json = b64DecodeToString(headerValue);
  const parsed = JSON.parse(json) as X402V2Challenge;
  if (parsed.x402Version !== 2) {
    throw new Error(`Unsupported x402 version: ${parsed.x402Version}`);
  }
  if (!Array.isArray(parsed.accepts) || parsed.accepts.length === 0) {
    throw new Error('x402 challenge has no accept options');
  }
  return parsed;
}

export async function signChallenge(
  privateKey: Hex,
  challenge: X402V2Challenge,
  opts: SignChallengeOptions = {},
): Promise<X402V2PaymentPayload> {
  const option = pickExactOption(challenge);
  const account = privateKeyToAccount(privateKey);
  const now = opts.now ?? (() => new Date());
  const randomBytes = opts.randomBytes ?? defaultRandomBytes;

  const nowSec = Math.floor(now().getTime() / 1000);
  const validAfter = (nowSec - 5).toString();
  const validBefore = (nowSec + Math.max(60, option.maxTimeoutSeconds)).toString();
  const nonce = `0x${bytesToHex(randomBytes(32))}` as Hex;

  const chainId = parseChainId(option.network);
  const domainName = option.extra?.name ?? 'USD Coin';
  const domainVersion = option.extra?.version ?? '2';

  const signature = await account.signTypedData({
    domain: {
      name: domainName,
      version: domainVersion,
      chainId,
      verifyingContract: option.asset,
    },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: {
      from: account.address,
      to: option.payTo,
      value: BigInt(option.amount),
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce,
    },
  });

  return {
    x402Version: 2,
    scheme: 'exact',
    network: option.network,
    payload: {
      signature,
      authorization: {
        from: account.address,
        to: option.payTo,
        value: option.amount,
        validAfter,
        validBefore,
        nonce,
      },
    },
  };
}

export function encodePaymentPayload(payload: X402V2PaymentPayload): string {
  return b64EncodeFromString(JSON.stringify(payload));
}

export function pickExactOption(challenge: X402V2Challenge): X402AcceptOption {
  const exact = challenge.accepts.find((a) => a.scheme === 'exact');
  if (!exact) {
    throw new Error(`No 'exact' scheme option in challenge`);
  }
  return exact;
}

// Convert v2 amount (integer base units) to a human-readable USDC decimal string
// using 6 decimals (USDC standard on Base).
export function formatUsdc(amountBaseUnits: string): string {
  const n = BigInt(amountBaseUnits);
  const whole = n / 1_000_000n;
  const frac = (n % 1_000_000n).toString().padStart(6, '0');
  return `${whole.toString()}.${frac}`;
}

function parseChainId(network: string): number {
  const m = /^eip155:(\d+)$/.exec(network);
  if (!m) throw new Error(`Unsupported network: ${network}`);
  return Number.parseInt(m[1]!, 10);
}

function defaultRandomBytes(n: number): Uint8Array {
  const arr = new Uint8Array(n);
  globalThis.crypto.getRandomValues(arr);
  return arr;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function b64EncodeFromString(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

function b64DecodeToString(s: string): string {
  return Buffer.from(s, 'base64').toString('utf8');
}
