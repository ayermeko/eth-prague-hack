'use client';
import type { DashboardEvent } from '../lib/useInvestigation';

export function EventFeed({ events }: { events: DashboardEvent[] }) {
  const transcript = events.filter((e): e is Extract<DashboardEvent, { type: 'codex.line' }> => e.type === 'codex.line');
  const toolEvents = events.filter(
    (e): e is Extract<DashboardEvent, { type: 'mcp.event' }> =>
      e.type === 'mcp.event' && (e.payload.kind === 'tool.start' || e.payload.kind === 'tool.end'),
  );
  const payments = events.filter(
    (e): e is Extract<DashboardEvent, { type: 'mcp.event' }> =>
      e.type === 'mcp.event' && e.payload.kind === 'payment',
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.15fr_0.85fr]">
      <Pane title="Codex transcript" count={transcript.length}>
        {transcript.length === 0 ? (
          <EmptyLine>Run the demo to watch the agent reason through the case.</EmptyLine>
        ) : (
          transcript.map((e, i) => (
            <div key={`${e.ts}-${i}`} className="border-l border-zinc-800 pl-3">
              <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                {formatTime(e.ts)}
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{e.line}</div>
            </div>
          ))
        )}
      </Pane>

      <div className="grid gap-4">
        <Pane title="x402 payments" count={payments.length}>
          {payments.length === 0 ? (
            <EmptyLine>No payment events yet.</EmptyLine>
          ) : (
            payments.map((event, i) => {
              const p = event.payload as Extract<typeof event.payload, { kind: 'payment' }>;
              return (
                <div key={`${event.ts}-${i}`} className="grid grid-cols-[auto_1fr_auto] gap-3 border border-zinc-800 bg-black p-3">
                  <span className={`mt-1 h-2 w-2 ${paymentDotClass(p.status)}`} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-xs font-semibold uppercase tracking-[0.14em] ${paymentTextClass(p.status)}`}>
                        {p.status}
                      </span>
                      <span className="text-xs text-zinc-500">{p.ppeEvent}</span>
                    </div>
                    <div className="mt-1 truncate font-mono text-xs text-zinc-300">{p.tool}</div>
                  </div>
                  <div className="text-right font-mono text-xs text-zinc-100">{p.amountUsdc}</div>
                </div>
              );
            })
          )}
        </Pane>

        <Pane title="Tool calls" count={toolEvents.length}>
          {toolEvents.length === 0 ? (
            <EmptyLine>No MCP tool calls yet.</EmptyLine>
          ) : (
            toolEvents.map((event, i) => {
              const tool = event.payload;
              const isEnd = tool.kind === 'tool.end';
              return (
                <div key={`${event.ts}-${i}`} className="flex items-start justify-between gap-3 border border-zinc-800 bg-black p-3">
                  <div>
                    <div className="font-mono text-xs text-zinc-200">{tool.tool}</div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {!isEnd ? 'started' : tool.ok ? `completed in ${tool.ms} ms` : tool.error}
                    </div>
                  </div>
                  <span className={`text-[10px] uppercase tracking-[0.14em] ${isEnd && tool.ok ? 'text-emerald-400' : 'text-zinc-500'}`}>
                    {!isEnd ? 'start' : tool.ok ? 'ok' : 'fail'}
                  </span>
                </div>
              );
            })
          )}
        </Pane>
      </div>
    </div>
  );
}

function Pane({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="min-h-64 border border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{title}</div>
        <div className="font-mono text-xs text-zinc-600">{count.toString().padStart(2, '0')}</div>
      </div>
      <div className="space-y-3 p-4 max-h-[56vh] overflow-y-auto">{children}</div>
    </section>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <div className="border border-dashed border-zinc-800 p-4 text-sm text-zinc-600">{children}</div>;
}

function formatTime(ts: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(ts));
}

function paymentTextClass(status: 'required' | 'signed' | 'settled' | 'failed'): string {
  return {
    required: 'text-amber-300',
    signed: 'text-sky-300',
    settled: 'text-emerald-300',
    failed: 'text-rose-300',
  }[status];
}

function paymentDotClass(status: 'required' | 'signed' | 'settled' | 'failed'): string {
  return {
    required: 'bg-amber-300',
    signed: 'bg-sky-300',
    settled: 'bg-emerald-300',
    failed: 'bg-rose-300',
  }[status];
}
