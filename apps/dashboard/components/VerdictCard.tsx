'use client';
import type { DashboardEvent } from '../lib/useInvestigation';

export function VerdictCard({ events }: { events: DashboardEvent[] }) {
  const verdictEvent = events.find((e): e is Extract<DashboardEvent, { type: 'verdict.rendered' }> => e.type === 'verdict.rendered');
  const completed = events.find((e) => e.type === 'investigation.completed') as
    | Extract<DashboardEvent, { type: 'investigation.completed' }>
    | undefined;
  if (!completed && !verdictEvent) return null;

  const settledPayments = events.filter(
    (e): e is Extract<DashboardEvent, { type: 'mcp.event' }> =>
      e.type === 'mcp.event' && e.payload.kind === 'payment' && e.payload.status === 'settled',
  );
  const total = settledPayments.reduce(
    (sum, e) => sum + Number.parseFloat((e.payload as { amountUsdc: string }).amountUsdc),
    0,
  );
  const verdict = verdictEvent?.verdict;

  return (
    <section className="grid gap-4 border border-emerald-800 bg-zinc-950 p-4 lg:grid-cols-[0.75fr_1.25fr]">
      <div className="border border-zinc-800 bg-black p-4">
        <div className="text-[11px] uppercase tracking-[0.2em] text-emerald-400">Final verdict</div>
        <div className="mt-5 flex items-end gap-3">
          <div className="text-6xl font-semibold text-zinc-50">{verdict?.score ?? '--'}</div>
          <div className="pb-2 text-sm uppercase tracking-[0.16em] text-zinc-500">/ 100</div>
        </div>
        <div className="mt-4 border-t border-zinc-800 pt-4">
          <div className="text-lg font-semibold text-emerald-300">
            {verdict?.label.replaceAll('_', ' ') ?? completed?.reason}
          </div>
          <div className="mt-2 text-sm text-zinc-500">
            Confidence: {verdict?.confidence ?? 'n/a'} · Duration: {verdict?.durationSec ?? '--'}s
          </div>
          <div className="mt-1 text-sm text-zinc-500">
            Settled payments: {settledPayments.length} · Total spent: ${total.toFixed(2)} USDC
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-zinc-500">Reasons</div>
          <div className="space-y-2">
            {(verdict?.reasons ?? ['Investigation completed.']).map((reason) => (
              <div key={reason} className="border border-zinc-800 bg-black p-3 text-sm leading-relaxed text-zinc-200">
                {reason}
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-zinc-500">Evidence trail</div>
          <div className="space-y-2">
            {(verdict?.evidence ?? []).map((item) => (
              <div key={item.source} className="border border-zinc-800 bg-black p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-zinc-100">{item.source}</div>
                  <div className="font-mono text-xs text-emerald-300">${item.costUsdc}</div>
                </div>
                <div className="mt-2 text-sm leading-relaxed text-zinc-500">{item.finding}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
