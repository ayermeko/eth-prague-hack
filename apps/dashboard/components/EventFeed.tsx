'use client';
import type { DashboardEvent } from '../lib/useInvestigation';

export function EventFeed({ events }: { events: DashboardEvent[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Pane title="Codex transcript">
        {events
          .filter((e) => e.type === 'codex.line')
          .map((e, i) => (
            <div key={i} className="text-xs text-zinc-300 whitespace-pre-wrap leading-snug">
              {(e as Extract<DashboardEvent, { type: 'codex.line' }>).line}
            </div>
          ))}
      </Pane>
      <Pane title="x402 payments">
        {events.flatMap((e, i) => {
          if (e.type !== 'mcp.event' || e.payload.kind !== 'payment') return [];
          const p = e.payload;
          const colour = {
            required: 'text-amber-400',
            signed: 'text-sky-400',
            settled: 'text-emerald-400',
            failed: 'text-rose-400',
          }[p.status];
          return [
            <div key={i} className={`text-xs ${colour}`}>
              {p.status.padEnd(8)} {p.amountUsdc} USDC → {p.tool}
              {p.ppeEvent ? ` · ${p.ppeEvent}` : ''}
              {p.error ? ` · ${p.error}` : ''}
            </div>,
          ];
        })}
      </Pane>
    </div>
  );
}

function Pane({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-zinc-800 rounded p-3">
      <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">{title}</div>
      <div className="space-y-1 max-h-[60vh] overflow-y-auto">{children}</div>
    </div>
  );
}
