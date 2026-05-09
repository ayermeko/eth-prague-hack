'use client';
import Link from 'next/link';
import { EventFeed } from '../../components/EventFeed';
import { useInvestigation } from '../../lib/useInvestigation';

export default function RunsPage() {
  const { runDemo, events, status } = useInvestigation();
  const empty = events.length === 0;

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-5 px-4 py-5 md:px-6">
      <header className="grid gap-4 border-b border-zinc-800 pb-5 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-emerald-400">
            execution detail
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal text-zinc-50 md:text-5xl">
            Run trace
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-500">
            Codex transcript, x402 payments, and MCP tool calls live here so the dashboard can stay focused on the workflow.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="status-dot" data-running={status === 'running'} />
          <span className="border border-zinc-800 px-3 py-2 text-xs uppercase tracking-[0.16em] text-zinc-400">
            {status}
          </span>
        </div>
      </header>

      {empty ? (
        <section className="border border-zinc-800 bg-zinc-950 p-5">
          <div className="text-sm font-semibold text-zinc-100">No run events yet</div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-500">
            Start a run from the dashboard, or play the demo here to populate the transcript and payment panels.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className="border border-emerald-400 bg-emerald-400 px-4 py-2 text-sm font-semibold text-black"
              onClick={runDemo}
            >
              Run demo
            </button>
            <Link href="/" className="border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100">
              Open dashboard
            </Link>
          </div>
        </section>
      ) : (
        <EventFeed events={events} />
      )}
    </main>
  );
}
