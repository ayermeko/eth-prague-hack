'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DashboardEvent } from '../lib/useInvestigation';

const ORCHESTRATOR =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:4000';
const LOW_BALANCE_USDC = 0.5;

interface WalletInfo {
  address: string;
  createdAt: string;
  balances: { usdc: string; eth: string };
}

interface WalletError {
  error: string;
  message: string;
  hint?: string;
}

type WalletState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; info: WalletInfo; fetchedAt: number }
  | { kind: 'error'; error: WalletError };

export function AgentWalletCard({ events }: { events: DashboardEvent[] }) {
  const [state, setState] = useState<WalletState>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);

  // The settled-payment counter changes once per on-chain settlement during a
  // live run. We use it as a refresh trigger so the card ticks down without
  // user interaction.
  const settledCount = useMemo(
    () =>
      events.filter(
        (e) =>
          e.type === 'mcp.event' &&
          e.payload.kind === 'payment' &&
          e.payload.status === 'settled',
      ).length,
    [events],
  );

  const fetchWallet = useCallback(async () => {
    setState((prev) => (prev.kind === 'loading' ? prev : { kind: 'loading' }));
    try {
      const res = await fetch(`${ORCHESTRATOR}/agent/wallet`);
      if (res.ok) {
        const info = (await res.json()) as WalletInfo;
        setState({ kind: 'ready', info, fetchedAt: Date.now() });
        return;
      }
      const body = (await res.json().catch(() => ({}))) as Partial<WalletError>;
      setState({
        kind: 'error',
        error: {
          error: body.error ?? 'unknown',
          message: body.message ?? `HTTP ${res.status}`,
          hint: body.hint,
        },
      });
    } catch (err) {
      setState({
        kind: 'error',
        error: {
          error: 'network',
          message: err instanceof Error ? err.message : 'request failed',
          hint: 'is the orchestrator running on ' + ORCHESTRATOR + '?',
        },
      });
    }
  }, []);

  // Initial load + refresh after every newly-settled payment event.
  useEffect(() => {
    void fetchWallet();
  }, [fetchWallet, settledCount]);

  async function copyAddress() {
    if (state.kind !== 'ready') return;
    try {
      await navigator.clipboard.writeText(state.info.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard denied — silently ignore, UI keeps working
    }
  }

  return (
    <section className="border border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Agent wallet</div>
            <span className="border border-emerald-700 px-2 py-[2px] text-[9px] uppercase tracking-[0.16em] text-emerald-300">
              mcpc keychain
            </span>
          </div>
          <div className="mt-1 text-sm font-semibold text-zinc-100">Base USDC balance</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold text-emerald-300">
            {state.kind === 'ready' ? `$${formatUsdc(state.info.balances.usdc)}` : '--'}
          </div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">
            {state.kind === 'ready' && Number(state.info.balances.usdc) < LOW_BALANCE_USDC
              ? 'low balance'
              : 'on-chain'}
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">Address</div>
          <button
            type="button"
            onClick={copyAddress}
            disabled={state.kind !== 'ready'}
            className="mt-1 block w-full truncate text-left font-mono text-xs text-zinc-200 hover:text-emerald-300 disabled:cursor-not-allowed disabled:text-zinc-600"
            title={state.kind === 'ready' ? 'click to copy' : ''}
          >
            {state.kind === 'ready' ? state.info.address : '— not loaded —'}
          </button>
          {state.kind === 'ready' && (
            <div className="mt-2 grid grid-cols-2 gap-3 text-[11px] text-zinc-500">
              <div>
                <span className="text-zinc-600">ETH for gas</span>{' '}
                <span className="font-mono text-zinc-300">{formatEth(state.info.balances.eth)}</span>
              </div>
              {state.info.createdAt && (
                <div>
                  <span className="text-zinc-600">created</span>{' '}
                  <span className="text-zinc-400">{formatDate(state.info.createdAt)}</span>
                </div>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={fetchWallet}
          disabled={state.kind === 'loading'}
          className="h-10 self-end border border-emerald-400 px-4 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-300 transition hover:bg-emerald-400 hover:text-black disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
        >
          {state.kind === 'loading' ? '...' : 'Refresh'}
        </button>
      </div>

      <div className="border-t border-zinc-800 px-4 py-3 text-xs text-zinc-500">
        {state.kind === 'ready' && (
          <span>
            {copied
              ? 'address copied to clipboard'
              : Number(state.info.balances.usdc) < LOW_BALANCE_USDC
                ? `Low balance — top up at the address before live runs (mcpc x402 info shows a QR).`
                : `Read from mcpc keychain. Private keys never leave your machine. Auto-refreshes when a payment settles.`}
          </span>
        )}
        {state.kind === 'loading' && <span>Reading wallet from mcpc...</span>}
        {state.kind === 'error' && (
          <div className="space-y-1">
            <div className="text-rose-400">
              {state.error.message || `mcpc reported: ${state.error.error}`}
            </div>
            {state.error.hint && <div className="text-zinc-500">{state.error.hint}</div>}
          </div>
        )}
        {state.kind === 'idle' && <span>Initializing wallet probe…</span>}
      </div>
    </section>
  );
}

function formatUsdc(raw: string): string {
  const num = Number(raw);
  if (!Number.isFinite(num)) return raw;
  if (num >= 100) return num.toFixed(2);
  if (num >= 1) return num.toFixed(2);
  return num.toFixed(4);
}

function formatEth(raw: string): string {
  const num = Number(raw);
  if (!Number.isFinite(num)) return raw;
  if (num === 0) return '0';
  if (num < 0.0001) return num.toExponential(2);
  return num.toFixed(4);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}
