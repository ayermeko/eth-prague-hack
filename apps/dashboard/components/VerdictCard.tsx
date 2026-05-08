'use client';
import type { DashboardEvent } from '../lib/useInvestigation';

export function VerdictCard({ events }: { events: DashboardEvent[] }) {
  const completed = events.find((e) => e.type === 'investigation.completed') as
    | Extract<DashboardEvent, { type: 'investigation.completed' }>
    | undefined;
  if (!completed) return null;

  const reason = completed.reason;
  const settledPayments = events.filter(
    (e): e is Extract<DashboardEvent, { type: 'mcp.event' }> =>
      e.type === 'mcp.event' && e.payload.kind === 'payment' && e.payload.status === 'settled',
  );
  const total = settledPayments.reduce(
    (sum, e) => sum + Number.parseFloat((e.payload as { amountUsdc: string }).amountUsdc),
    0,
  );

  return (
    <div className="border border-emerald-700 rounded p-4 mt-4">
      <div className="text-sm text-emerald-400">
        Investigation complete · reason: {reason}
      </div>
      <div className="text-xs text-zinc-400 mt-1">
        Settled payments: {settledPayments.length} · Total spent: ${total.toFixed(4)} USDC
      </div>
    </div>
  );
}
