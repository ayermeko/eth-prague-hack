'use client';
import { useEffect, useMemo, useState } from 'react';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_RPC = process.env.NEXT_PUBLIC_BASE_RPC_URL ?? 'https://mainnet.base.org';
const DEFAULT_WALLET = process.env.NEXT_PUBLIC_AGENT_WALLET_ADDRESS ?? '';
const STORAGE_KEY = 'rugsleuth.agentWallet';

type BalanceState =
  | { kind: 'idle'; message: string }
  | { kind: 'loading'; message: string }
  | { kind: 'ready'; usdc: string; source: 'base' | 'demo' }
  | { kind: 'error'; message: string };

export function AgentWalletCard() {
  const [address, setAddress] = useState(DEFAULT_WALLET);
  const [balance, setBalance] = useState<BalanceState>({ kind: 'idle', message: 'Connect a read-only wallet address.' });
  const valid = useMemo(() => /^0x[a-fA-F0-9]{40}$/.test(address), [address]);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) setAddress(stored);
  }, []);

  async function refresh() {
    if (!valid) {
      setBalance({ kind: 'error', message: 'Enter a 0x wallet address to read Base USDC balance.' });
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, address);
    setBalance({ kind: 'loading', message: 'Reading Base USDC balance...' });

    try {
      const raw = await readUsdcBalance(address);
      setBalance({ kind: 'ready', usdc: formatUsdc(raw), source: 'base' });
    } catch (err) {
      setBalance({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Could not read wallet balance.',
      });
    }
  }

  function useDemoWallet() {
    const demo = '0x0000000000000000000000000000000000000bee';
    setAddress(demo);
    window.localStorage.setItem(STORAGE_KEY, demo);
    setBalance({ kind: 'ready', usdc: '5.230000', source: 'demo' });
  }

  return (
    <section className="border border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Agentic wallet</div>
          <div className="mt-1 text-sm font-semibold text-zinc-100">Base USDC balance</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold text-emerald-300">
            {balance.kind === 'ready' ? `$${Number(balance.usdc).toFixed(2)}` : '--'}
          </div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">
            {balance.kind === 'ready' ? balance.source : 'read-only'}
          </div>
        </div>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-[1fr_auto_auto]">
        <input
          className="h-10 min-w-0 border border-zinc-700 bg-black px-3 font-mono text-xs text-zinc-100 outline-none transition focus:border-emerald-400"
          placeholder="0x agent wallet address"
          value={address}
          onChange={(event) => setAddress(event.target.value.trim())}
        />
        <button
          type="button"
          className="h-10 border border-emerald-400 px-4 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-300 transition hover:bg-emerald-400 hover:text-black disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
          disabled={balance.kind === 'loading'}
          onClick={refresh}
        >
          Refresh
        </button>
        <button
          type="button"
          className="h-10 border border-zinc-700 px-4 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-300 transition hover:border-zinc-500"
          onClick={useDemoWallet}
        >
          Demo wallet
        </button>
      </div>
      <div className="border-t border-zinc-800 px-4 py-3 text-xs text-zinc-500">
        {balance.kind === 'ready'
          ? `${balance.usdc} USDC on Base. Private keys stay outside the browser.`
          : balance.message}
      </div>
    </section>
  );
}

async function readUsdcBalance(address: string): Promise<bigint> {
  const data = `0x70a08231${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
  const res = await fetch(BASE_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: USDC_BASE, data }, 'latest'],
    }),
  });

  if (!res.ok) throw new Error(`Base RPC returned HTTP ${res.status}`);
  const body = (await res.json()) as { result?: string; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? 'Base RPC error');
  if (!body.result) throw new Error('Base RPC returned no balance result');
  return BigInt(body.result);
}

function formatUsdc(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const frac = (raw % 1_000_000n).toString().padStart(6, '0');
  return `${whole.toString()}.${frac}`;
}
