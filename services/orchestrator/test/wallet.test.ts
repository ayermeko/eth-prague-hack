import { describe, expect, it, vi } from 'vitest';
import { fetchAgentWallet, type WalletExec } from '../src/wallet.js';

function makeExec(impl: WalletExec): WalletExec {
  return vi.fn(impl) as unknown as WalletExec;
}

describe('fetchAgentWallet', () => {
  it('returns a structured snapshot when mcpc succeeds', async () => {
    const exec = makeExec(async () => ({
      stdout: JSON.stringify({
        address: '0xDf6D94140C0b17eAFAF3C9dc8e9F941B425bF57e',
        createdAt: '2026-05-08T16:00:44.370Z',
        balances: { eth: '0', usdc: '1.230000' },
      }),
      stderr: '',
    }));
    const result = await fetchAgentWallet({ exec });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.info.address).toBe('0xDf6D94140C0b17eAFAF3C9dc8e9F941B425bF57e');
    expect(result.info.balances.usdc).toBe('1.230000');
    expect(result.info.balances.eth).toBe('0');
  });

  it('classifies ENOENT as mcpc_missing with install hint', async () => {
    const exec = makeExec(async () => {
      const err = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
      throw err;
    });
    const result = await fetchAgentWallet({ exec });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.kind).toBe('mcpc_missing');
    expect(result.error.hint).toContain('@apify/mcpc');
  });

  it('classifies "no wallet" stderr as no_wallet with init hint', async () => {
    const exec = makeExec(async () => {
      const err = Object.assign(new Error('mcpc exited 1'), {
        stderr: 'Error: No wallet configured for x402.',
      });
      throw err;
    });
    const result = await fetchAgentWallet({ exec, bin: 'mcpc' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.kind).toBe('no_wallet');
    expect(result.error.hint).toContain('mcpc x402 init');
  });

  it('flags non-JSON stdout as subprocess_failed', async () => {
    const exec = makeExec(async () => ({ stdout: 'this is not json', stderr: '' }));
    const result = await fetchAgentWallet({ exec });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.kind).toBe('subprocess_failed');
    expect(result.error.message).toContain('non-JSON');
  });

  it('flags JSON missing required fields as subprocess_failed', async () => {
    const exec = makeExec(async () => ({
      stdout: JSON.stringify({ address: '0xabc', balances: { usdc: '1' } }),
      stderr: '',
    }));
    const result = await fetchAgentWallet({ exec });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('missing required fields');
  });
});
