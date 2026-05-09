'use client';
import { useMemo, useState } from 'react';
import type { DashboardEvent } from '../lib/useInvestigation';

type NodeId = 'input' | 'orchestrator' | 'codex' | 'mcp' | 'x402' | 'apify' | 'verdict';
type NodeStatus = 'waiting' | 'running' | 'success' | 'failed';

interface WorkflowNode {
  id: NodeId;
  title: string;
  subtitle: string;
  meta: string;
  x: number;
  y: number;
}

const nodes: WorkflowNode[] = [
  { id: 'input', title: 'Address Input', subtitle: 'Base contract', meta: 'trigger', x: 40, y: 200 },
  { id: 'orchestrator', title: 'Orchestrator', subtitle: 'Fastify + SSE', meta: 'backend', x: 230, y: 80 },
  { id: 'codex', title: 'Codex Agent', subtitle: 'Plans investigation', meta: 'agent', x: 460, y: 80 },
  { id: 'mcp', title: 'MCP Tool', subtitle: 'scrape_* tools', meta: 'stdio', x: 460, y: 320 },
  { id: 'x402', title: 'x402 Payment', subtitle: '402 -> sign -> retry', meta: 'wallet', x: 690, y: 320 },
  { id: 'apify', title: 'Apify Actor', subtitle: 'Paid scraper', meta: 'intel', x: 900, y: 320 },
  { id: 'verdict', title: 'Verdict', subtitle: 'Score + evidence', meta: 'output', x: 900, y: 80 },
];

const links: Array<{ from: NodeId; to: NodeId; path: string }> = [
  { from: 'input', to: 'orchestrator', path: 'M192 252 C220 252 200 130 230 130' },
  { from: 'orchestrator', to: 'codex', path: 'M382 130 C410 130 430 130 460 130' },
  { from: 'codex', to: 'mcp', path: 'M536 184 C536 230 536 274 536 320' },
  { from: 'mcp', to: 'x402', path: 'M612 372 C640 372 662 372 690 372' },
  { from: 'x402', to: 'apify', path: 'M842 372 C864 372 878 372 900 372' },
  { from: 'apify', to: 'verdict', path: 'M976 320 C976 268 976 236 976 184' },
  { from: 'codex', to: 'verdict', path: 'M612 130 C715 130 797 130 900 130' },
];

const CANVAS_WIDTH = 1092;
const CANVAS_HEIGHT = 560;
const MIN_ZOOM = 0.65;
const MAX_ZOOM = 1.35;
const ZOOM_STEP = 0.1;

const nodeCopy: Record<NodeId, { role: string; details: string[] }> = {
  input: {
    role: 'The user starts the workflow with a suspicious Base address.',
    details: ['Validates the address format', 'Creates a new investigation request', 'Starts the visible execution trace'],
  },
  orchestrator: {
    role: 'The backend owns execution policy and streams every event to the browser.',
    details: ['Spawns Codex CLI', 'Registers MCP tools', 'Tracks budget and timeout', 'Publishes SSE events'],
  },
  codex: {
    role: 'Codex is the autonomous investigator deciding what evidence to buy.',
    details: ['Plans cheap signals first', 'Calls tools through MCP', 'Stops once confidence is high enough'],
  },
  mcp: {
    role: 'The MCP server exposes paid scraper tools to the agent.',
    details: ['Validates tool arguments', 'Calls x402-client', 'Emits tool and payment logs'],
  },
  x402: {
    role: 'The payment layer turns paid APIs into wallet-native HTTP calls.',
    details: ['Receives HTTP 402 challenge', 'Signs with the agent wallet', 'Retries with PAYMENT-SIGNATURE'],
  },
  apify: {
    role: 'Apify Actors produce the paid intelligence.',
    details: ['Runs BaseScan/Dex/Social scrapers', 'Charges pay-per-event', 'Returns compact dataset items'],
  },
  verdict: {
    role: 'The final report summarizes evidence, spend, and risk.',
    details: ['Computes a rug score', 'Lists reasons and evidence', 'Shows total USDC spent'],
  },
};

export function WorkflowCanvas({ events }: { events: DashboardEvent[] }) {
  const { statuses, activeNode, inspector, activeLinks, totals } = useMemo(() => buildWorkflowState(events), [events]);
  const [selected, setSelected] = useState<NodeId | null>(null);
  const [zoom, setZoom] = useState(0.86);
  const selectedNode = selected ?? activeNode;
  const selectedMeta = nodes.find((node) => node.id === selectedNode) ?? nodes[0];
  const zoomPercent = Math.round(zoom * 100);
  const setBoundedZoom = (next: number) => setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(next.toFixed(2)))));

  return (
    <section className="grid min-h-[620px] gap-4 lg:grid-cols-[1fr_340px]">
      <div className="workflow-shell">
        <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4 py-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Workflow editor</div>
            <div className="mt-1 text-sm font-semibold text-zinc-100">RugSleuth demo execution</div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="flex items-center border border-zinc-800 bg-black">
              <button type="button" className="workflow-zoom-button" onClick={() => setBoundedZoom(zoom - ZOOM_STEP)} aria-label="Zoom out">
                -
              </button>
              <div className="w-14 border-x border-zinc-800 text-center font-mono text-xs text-zinc-400">{zoomPercent}%</div>
              <button type="button" className="workflow-zoom-button" onClick={() => setBoundedZoom(zoom + ZOOM_STEP)} aria-label="Zoom in">
                +
              </button>
              <button type="button" className="workflow-zoom-fit" onClick={() => setZoom(0.86)}>
                Fit
              </button>
            </div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-zinc-500">
              <span>{totals.events} events</span>
              <span className="border-l border-zinc-800 pl-2">${totals.spend.toFixed(2)} spent</span>
            </div>
          </div>
        </div>

        <div className="workflow-canvas">
          <div className="workflow-scaled-space" style={{ width: CANVAS_WIDTH * zoom, height: CANVAS_HEIGHT * zoom }}>
            <div
              className="workflow-content"
              style={{
                width: CANVAS_WIDTH,
                height: CANVAS_HEIGHT,
                transform: `scale(${zoom})`,
              }}
            >
              <svg className="pointer-events-none absolute left-0 top-0" width={CANVAS_WIDTH} height={CANVAS_HEIGHT} viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} aria-hidden="true">
                {links.map((link) => (
                  <path
                    key={`${link.from}-${link.to}`}
                    d={link.path}
                    className={activeLinks.has(`${link.from}:${link.to}`) ? 'workflow-link workflow-link-active' : 'workflow-link'}
                    fill="none"
                  />
                ))}
              </svg>

              {nodes.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  className={`workflow-node workflow-node-${statuses[node.id]} ${selectedNode === node.id ? 'workflow-node-selected' : ''}`}
                  style={{ left: node.x, top: node.y }}
                  onClick={() => setSelected(node.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{node.meta}</div>
                      <div className="mt-2 text-sm font-semibold text-zinc-100">{node.title}</div>
                      <div className="mt-1 text-xs text-zinc-500">{node.subtitle}</div>
                    </div>
                    <span className="workflow-info" aria-label={`${node.title}: ${nodeCopy[node.id].role}`}>
                      i
                      <span className="workflow-info-popover">{nodeCopy[node.id].role}</span>
                    </span>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">{statuses[node.id]}</span>
                    <span className="workflow-status-dot" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <aside className="border border-zinc-800 bg-zinc-950">
        <div className="border-b border-zinc-800 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Inspector</div>
          <div className="mt-1 text-lg font-semibold text-zinc-100">{selectedMeta.title}</div>
        </div>
        <div className="space-y-5 p-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-600">Role</div>
            <p className="mt-2 text-sm leading-relaxed text-zinc-300">{nodeCopy[selectedMeta.id].role}</p>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-600">What happens here</div>
            <div className="mt-2 space-y-2">
              {nodeCopy[selectedMeta.id].details.map((detail) => (
                <div key={detail} className="border border-zinc-800 bg-black p-3 text-sm text-zinc-400">
                  {detail}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-600">Current event</div>
            <div className="mt-2 border border-zinc-800 bg-black p-3 font-mono text-xs leading-relaxed text-zinc-300">
              {inspector[selectedMeta.id] ?? 'Waiting for this node to execute.'}
            </div>
          </div>
        </div>
      </aside>
    </section>
  );
}

function buildWorkflowState(events: DashboardEvent[]) {
  const statuses: Record<NodeId, NodeStatus> = {
    input: events.length > 0 ? 'success' : 'waiting',
    orchestrator: events.length > 0 ? 'success' : 'waiting',
    codex: hasCodex(events) ? 'success' : 'waiting',
    mcp: hasToolEnd(events) ? 'success' : hasToolStart(events) ? 'running' : 'waiting',
    x402: hasPayment(events, 'settled') ? 'success' : hasAnyPayment(events) ? 'running' : 'waiting',
    apify: hasToolEnd(events) ? 'success' : hasToolStart(events) ? 'running' : 'waiting',
    verdict: hasCompleted(events) ? 'success' : hasVerdict(events) ? 'running' : 'waiting',
  };

  if (events.some((event) => event.type === 'investigation.completed' && event.reason === 'error')) {
    statuses.verdict = 'failed';
  }

  const activeNode = deriveActiveNode(events);
  if (statuses[activeNode] === 'waiting') statuses[activeNode] = 'running';

  return {
    statuses,
    activeNode,
    inspector: buildInspector(events),
    activeLinks: buildActiveLinks(statuses),
    totals: {
      events: events.length,
      spend: settledSpend(events),
    },
  };
}

function deriveActiveNode(events: DashboardEvent[]): NodeId {
  const latest = events.at(-1);
  if (!latest) return 'input';
  if (latest.type === 'verdict.rendered' || latest.type === 'investigation.completed') return 'verdict';
  if (latest.type === 'codex.line') return latest.line.startsWith('VERDICT:') ? 'verdict' : 'codex';
  if (latest.type === 'mcp.event') {
    if (latest.payload.kind === 'payment') return 'x402';
    if (latest.payload.kind === 'tool.end') return 'apify';
    return 'mcp';
  }
  return 'orchestrator';
}

function buildInspector(events: DashboardEvent[]): Partial<Record<NodeId, string>> {
  const latestCodex = [...events].reverse().find((event): event is Extract<DashboardEvent, { type: 'codex.line' }> => event.type === 'codex.line');
  const latestTool = [...events]
    .reverse()
    .find((event): event is Extract<DashboardEvent, { type: 'mcp.event' }> => event.type === 'mcp.event' && (event.payload.kind === 'tool.start' || event.payload.kind === 'tool.end'));
  const latestPayment = [...events]
    .reverse()
    .find((event): event is Extract<DashboardEvent, { type: 'mcp.event' }> => event.type === 'mcp.event' && event.payload.kind === 'payment');
  const latestVerdict = [...events].reverse().find((event): event is Extract<DashboardEvent, { type: 'verdict.rendered' }> => event.type === 'verdict.rendered');
  const toolPayload = latestTool?.payload.kind === 'tool.start' || latestTool?.payload.kind === 'tool.end' ? latestTool.payload : undefined;
  const paymentPayload = latestPayment?.payload.kind === 'payment' ? latestPayment.payload : undefined;

  return {
    input: events.length > 0 ? 'Investigation request created from the demo address.' : 'Ready for a contract address.',
    orchestrator: events.length > 0 ? 'Investigation id allocated and event stream opened.' : 'Waiting for POST /investigations.',
    codex: latestCodex?.line,
    mcp: toolPayload ? `${toolPayload.kind}: ${toolPayload.tool}` : undefined,
    x402: paymentPayload
      ? `${paymentPayload.status} ${paymentPayload.amountUsdc} USDC for ${paymentPayload.tool}`
      : undefined,
    apify:
      toolPayload?.kind === 'tool.end'
        ? toolPayload.ok
          ? `Actor returned data in ${toolPayload.ms} ms.`
          : toolPayload.error
        : undefined,
    verdict: latestVerdict
      ? `${latestVerdict.verdict.score}/100 ${latestVerdict.verdict.label.replaceAll('_', ' ')}`
      : undefined,
  };
}

function buildActiveLinks(statuses: Record<NodeId, NodeStatus>) {
  const active = new Set<string>();
  for (const link of links) {
    if (statuses[link.from] !== 'waiting' && statuses[link.to] !== 'waiting') {
      active.add(`${link.from}:${link.to}`);
    }
  }
  return active;
}

function hasCodex(events: DashboardEvent[]) {
  return events.some((event) => event.type === 'codex.line');
}

function hasToolStart(events: DashboardEvent[]) {
  return events.some((event) => event.type === 'mcp.event' && event.payload.kind === 'tool.start');
}

function hasToolEnd(events: DashboardEvent[]) {
  return events.some((event) => event.type === 'mcp.event' && event.payload.kind === 'tool.end' && event.payload.ok);
}

function hasAnyPayment(events: DashboardEvent[]) {
  return events.some((event) => event.type === 'mcp.event' && event.payload.kind === 'payment');
}

function hasPayment(events: DashboardEvent[], status: 'settled') {
  return events.some((event) => event.type === 'mcp.event' && event.payload.kind === 'payment' && event.payload.status === status);
}

function hasVerdict(events: DashboardEvent[]) {
  return events.some((event) => event.type === 'verdict.rendered');
}

function hasCompleted(events: DashboardEvent[]) {
  return events.some((event) => event.type === 'investigation.completed');
}

function settledSpend(events: DashboardEvent[]) {
  return events.reduce((sum, event) => {
    if (event.type === 'mcp.event' && event.payload.kind === 'payment' && event.payload.status === 'settled') {
      return sum + Number.parseFloat(event.payload.amountUsdc);
    }
    return sum;
  }, 0);
}
