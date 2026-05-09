'use client';
import { AddressInput } from '../components/AddressInput';
import { AgentWalletCard } from '../components/AgentWalletCard';
import { VerdictCard } from '../components/VerdictCard';
import { WorkflowCanvas } from '../components/WorkflowCanvas';
import { useInvestigation } from '../lib/useInvestigation';

export default function Page() {
  const { start, runDemo, events, status, error } = useInvestigation();
  const isRunning = status === 'running';

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-5 px-4 py-5 md:px-6">
      <header className="grid gap-4 border-b border-zinc-800 pb-5 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-emerald-400">
            x402 autonomous investigation
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal text-zinc-50 md:text-5xl">
            RugSleuth
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="status-dot" data-running={isRunning} />
          <span className="border border-zinc-800 px-3 py-2 text-xs uppercase tracking-[0.16em] text-zinc-400">
            {status}
          </span>
        </div>
      </header>

      <AddressInput onSubmit={start} onDemo={runDemo} disabled={isRunning} />
      {error && <div className="text-rose-400 text-sm">{error}</div>}

      <AgentWalletCard />
      <WorkflowCanvas events={events} />
      <VerdictCard events={events} />
    </main>
  );
}
