'use client';
import { AddressInput } from '../components/AddressInput';
import { EventFeed } from '../components/EventFeed';
import { VerdictCard } from '../components/VerdictCard';
import { useInvestigation } from '../lib/useInvestigation';

export default function Page() {
  const { start, startMock, mockAddress, events, status, error } = useInvestigation();
  return (
    <main className="max-w-5xl mx-auto p-6 space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">RugSleuth</h1>
        <span className="text-xs text-zinc-500">{status}</span>
      </header>
      <AddressInput onSubmit={start} disabled={status === 'running'} />
      <div className="flex items-center gap-3 text-xs">
        <button
          className="px-3 py-1.5 rounded border border-amber-700 text-amber-400 hover:bg-amber-950 disabled:opacity-30"
          onClick={startMock}
          disabled={status === 'running'}
          type="button"
        >
          ▶ Run mock investigation
        </button>
        <span className="text-zinc-500">
          No x402 calls, no USDC spent. Replays a scripted run against{' '}
          <code className="font-mono text-zinc-400">{mockAddress.slice(0, 10)}…</code> so you can see the
          Codex agent + payment flow.
        </span>
      </div>
      {error && <div className="text-rose-400 text-sm">{error}</div>}
      <EventFeed events={events} />
      <VerdictCard events={events} />
    </main>
  );
}
