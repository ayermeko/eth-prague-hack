const sections = [
  {
    title: 'What RugSleuth does',
    body: 'RugSleuth is an autonomous onchain investigation demo. A user gives it a Base contract address, and the agent buys data from paid services only when that evidence is worth the spend.',
  },
  {
    title: 'Why x402 matters',
    body: 'x402 turns paid HTTP services into wallet-native endpoints. Instead of an API key or account, the agent receives a 402 payment challenge, signs with its wallet, and retries the request with a payment signature.',
  },
  {
    title: 'What the demo proves',
    body: 'The local demo proves the product flow: dashboard events, Codex-style planning, MCP tool calls, x402 payment lifecycle, paid scraper results, and final verdict rendering.',
  },
];

const stack = [
  ['Dashboard', 'Next.js interface with workflow canvas, run trace, and wallet balance reader.'],
  ['Orchestrator', 'Fastify service that starts Codex, streams SSE events, and enforces budget.'],
  ['Codex Agent', 'Autonomous agent harness that decides which tools to call.'],
  ['MCP Server', 'Tool bridge exposing scraper actions to the agent.'],
  ['x402 Client', 'Signs HTTP 402 payment challenges using the agent wallet.'],
  ['Apify Actor', 'Paid scraper that returns BaseScan intelligence.'],
];

export default function AboutPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-5 px-4 py-5 md:px-6">
      <header className="border-b border-zinc-800 pb-5">
        <div className="text-[11px] uppercase tracking-[0.24em] text-emerald-400">about the project</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-normal text-zinc-50 md:text-5xl">
          Agent pays. Agent investigates.
        </h1>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-zinc-500">
          RugSleuth was built for the Apify x402 bounty: a tangible use case where an autonomous agent pays for
          real-time web and onchain intelligence while producing a readable risk report.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        {sections.map((section) => (
          <article key={section.title} className="border border-zinc-800 bg-zinc-950 p-5">
            <h2 className="text-lg font-semibold text-zinc-100">{section.title}</h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-500">{section.body}</p>
          </article>
        ))}
      </section>

      <section className="border border-zinc-800 bg-zinc-950">
        <div className="border-b border-zinc-800 px-5 py-4">
          <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Architecture</div>
          <h2 className="mt-1 text-xl font-semibold text-zinc-100">How the pieces fit</h2>
        </div>
        <div className="grid gap-0 md:grid-cols-2">
          {stack.map(([name, description]) => (
            <div key={name} className="border-b border-zinc-800 p-5 md:border-r">
              <div className="text-sm font-semibold text-emerald-300">{name}</div>
              <div className="mt-2 text-sm leading-relaxed text-zinc-500">{description}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="border border-zinc-800 bg-black p-5">
        <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Current status</div>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-zinc-400">
          The dashboard demo is intentionally fake but structurally accurate. The mock path exercises the same
          event flow as the real app. A real run requires a deployed Apify Actor, a funded Base wallet, and the
          orchestrator environment variables for Codex and x402.
        </p>
      </section>
    </main>
  );
}
