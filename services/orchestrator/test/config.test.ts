import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';

const baseEnv = {
  BASESCAN_DEEP_ACTOR_ID: 'user/basescan-deep',
};

describe('parseConfig', () => {
  it('accepts token mode without a wallet private key', () => {
    const config = parseConfig({
      ...baseEnv,
      APIFY_PAYMENT_MODE: 'token',
      APIFY_TOKEN: 'apify_api_test',
    });

    expect(config.APIFY_PAYMENT_MODE).toBe('token');
    expect(config.APIFY_TOKEN).toBe('apify_api_test');
    expect(config.WALLET_PRIVATE_KEY).toBeUndefined();
  });

  it('rejects token mode without APIFY_TOKEN', () => {
    expect(() =>
      parseConfig({
        ...baseEnv,
        APIFY_PAYMENT_MODE: 'token',
      }),
    ).toThrow('APIFY_TOKEN is required when APIFY_PAYMENT_MODE=token');
  });

  it('rejects x402 mode without WALLET_PRIVATE_KEY', () => {
    expect(() =>
      parseConfig({
        ...baseEnv,
        APIFY_PAYMENT_MODE: 'x402',
      }),
    ).toThrow('WALLET_PRIVATE_KEY is required when APIFY_PAYMENT_MODE=x402');
  });
});
