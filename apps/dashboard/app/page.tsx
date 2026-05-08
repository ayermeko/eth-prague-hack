'use client';
import { AddressInput } from '../components/AddressInput';
import { EventFeed } from '../components/EventFeed';
import { VerdictCard } from '../components/VerdictCard';
import { useInvestigation } from '../lib/useInvestigation';

export default function Page() {
  const { start, events, status, error } = useInvestigation();
  return (
    <main className="max-w-5xl mx-auto p-6 space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">RugSleuth</h1>
        <span className="text-xs text-zinc-500">{status}</span>
      </header>
      <AddressInput onSubmit={start} disabled={status === 'running'} />
      {error && <div className="text-rose-400 text-sm">{error}</div>}
      <EventFeed events={events} />
      <VerdictCard events={events} />
    </main>
  );
}
