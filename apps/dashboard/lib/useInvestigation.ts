// apps/dashboard/lib/useInvestigation.ts
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export type InvestigationStatus = 'idle' | 'running' | 'done' | 'error';

export type DashboardEvent =
  | { type: 'codex.line'; line: string; ts: string }
  | {
      type: 'mcp.event';
      ts: string;
      payload:
        | { kind: 'tool.start'; tool: string; args: Record<string, unknown> }
        | { kind: 'tool.end'; tool: string; ok: boolean; error?: string; ms: number }
        | {
            kind: 'payment';
            tool: string;
            status: 'required' | 'signed' | 'settled' | 'failed';
            amountUsdc: string;
            payTo: string;
            ppeEvent?: string;
            error?: string;
          };
    }
  | { type: 'budget.exceeded'; spentUsdc: string; ts: string }
  | {
      type: 'investigation.completed';
      reason: 'verdict' | 'timeout' | 'budget' | 'error';
      ts: string;
    }
  | {
      type: 'verdict.rendered';
      ts: string;
      verdict: {
        score: number;
        label: 'LIKELY_RUG' | 'SUSPICIOUS' | 'INCONCLUSIVE' | 'LIKELY_LEGIT';
        confidence: string;
        reasons: string[];
        evidence: Array<{ source: string; finding: string; costUsdc: string }>;
        durationSec: number;
      };
    };

type UnstampedEvent = DashboardEvent extends infer Event
  ? Event extends { ts: string }
    ? Omit<Event, 'ts'>
    : never
  : never;

const ORCHESTRATOR =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:4000';

const DEMO_ADDRESS = '0xc1fcc4300305a415a7ea894f71a0694e9f7831d3';
const EVENTS_STORAGE_KEY = 'rugsleuth.latestEvents';
const STATUS_STORAGE_KEY = 'rugsleuth.latestStatus';

const demoTimeline: Array<{ delay: number; event: UnstampedEvent }> = [
  {
    delay: 200,
    event: {
      type: 'codex.line',
      line: `RugSleuth received ${DEMO_ADDRESS} on Base. Budget: 2.00 USDC.`,
    },
  },
  {
    delay: 900,
    event: {
      type: 'codex.line',
      line: 'Plan: start with cheap contract metadata, then decide whether deeper signals are worth paying for.',
    },
  },
  {
    delay: 1500,
    event: {
      type: 'mcp.event',
      payload: { kind: 'tool.start', tool: 'scrape_basescan_address', args: { address: DEMO_ADDRESS } },
    },
  },
  {
    delay: 2100,
    event: {
      type: 'mcp.event',
      payload: {
        kind: 'payment',
        tool: 'scrape_basescan_address',
        status: 'required',
        amountUsdc: '0.050000',
        payTo: '0x0000000000000000000000000000000000000bee',
        ppeEvent: 'address-fetched',
      },
    },
  },
  {
    delay: 2700,
    event: {
      type: 'mcp.event',
      payload: {
        kind: 'payment',
        tool: 'scrape_basescan_address',
        status: 'signed',
        amountUsdc: '0.050000',
        payTo: '0x0000000000000000000000000000000000000bee',
        ppeEvent: 'address-fetched',
      },
    },
  },
  {
    delay: 3400,
    event: {
      type: 'mcp.event',
      payload: {
        kind: 'payment',
        tool: 'scrape_basescan_address',
        status: 'settled',
        amountUsdc: '0.050000',
        payTo: '0x0000000000000000000000000000000000000bee',
        ppeEvent: 'address-fetched',
      },
    },
  },
  {
    delay: 3900,
    event: {
      type: 'mcp.event',
      payload: { kind: 'tool.end', tool: 'scrape_basescan_address', ok: true, ms: 812 },
    },
  },
  {
    delay: 4500,
    event: {
      type: 'codex.line',
      line: 'Finding: contract is unverified and has sparse history. Pulling free reputation lookups before paying for deeper signals.',
    },
  },
  {
    delay: 5100,
    event: {
      type: 'mcp.event',
      payload: { kind: 'tool.start', tool: 'check_scam_blacklists', args: { address: DEMO_ADDRESS } },
    },
  },
  {
    delay: 5700,
    event: {
      type: 'mcp.event',
      payload: { kind: 'tool.end', tool: 'check_scam_blacklists', ok: true, ms: 412 },
    },
  },
  {
    delay: 6200,
    event: {
      type: 'codex.line',
      line: 'Free GoPlus + ScamSniffer lookup: 1 hit (cybercrime, high severity). Worth paying to confirm with deployer history.',
    },
  },
  {
    delay: 6800,
    event: {
      type: 'mcp.event',
      payload: { kind: 'tool.start', tool: 'list_deployer_contracts', args: { address: DEMO_ADDRESS } },
    },
  },
  {
    delay: 7300,
    event: {
      type: 'mcp.event',
      payload: {
        kind: 'payment',
        tool: 'list_deployer_contracts',
        status: 'required',
        amountUsdc: '0.080000',
        payTo: '0x0000000000000000000000000000000000000bee',
        ppeEvent: 'deployer-history-fetched',
      },
    },
  },
  {
    delay: 7700,
    event: {
      type: 'mcp.event',
      payload: {
        kind: 'payment',
        tool: 'list_deployer_contracts',
        status: 'settled',
        amountUsdc: '0.080000',
        payTo: '0x0000000000000000000000000000000000000bee',
        ppeEvent: 'deployer-history-fetched',
      },
    },
  },
  {
    delay: 8300,
    event: {
      type: 'mcp.event',
      payload: { kind: 'tool.end', tool: 'list_deployer_contracts', ok: true, ms: 998 },
    },
  },
  {
    delay: 8900,
    event: {
      type: 'codex.line',
      line: 'Deployer launched 14 contracts in the last 30 days; 11 of 14 are unverified. Serial-deployer pattern. Checking funding cluster.',
    },
  },
  {
    delay: 9400,
    event: {
      type: 'mcp.event',
      payload: { kind: 'tool.start', tool: 'analyze_wallet_cluster', args: { address: DEMO_ADDRESS, maxRelated: 20 } },
    },
  },
  {
    delay: 9800,
    event: {
      type: 'mcp.event',
      payload: {
        kind: 'payment',
        tool: 'analyze_wallet_cluster',
        status: 'settled',
        amountUsdc: '0.100000',
        payTo: '0x0000000000000000000000000000000000000bee',
        ppeEvent: 'cluster-fetched',
      },
    },
  },
  {
    delay: 10500,
    event: {
      type: 'mcp.event',
      payload: { kind: 'tool.end', tool: 'analyze_wallet_cluster', ok: true, ms: 1102 },
    },
  },
  {
    delay: 11100,
    event: {
      type: 'codex.line',
      line: 'Funding source classified as mixer (Tornado Cash 1 ETH). Cross-checking with X mentions.',
    },
  },
  {
    delay: 11600,
    event: {
      type: 'mcp.event',
      payload: { kind: 'tool.start', tool: 'scrape_x_mentions', args: { address: DEMO_ADDRESS } },
    },
  },
  {
    delay: 12000,
    event: {
      type: 'mcp.event',
      payload: {
        kind: 'payment',
        tool: 'scrape_x_mentions',
        status: 'settled',
        amountUsdc: '0.040000',
        payTo: '0x0000000000000000000000000000000000000bee',
        ppeEvent: 'tweet-fetched',
      },
    },
  },
  {
    delay: 12600,
    event: {
      type: 'mcp.event',
      payload: { kind: 'tool.end', tool: 'scrape_x_mentions', ok: true, ms: 944 },
    },
  },
  {
    delay: 13100,
    event: {
      type: 'codex.line',
      line: '5 mentions found on X, 2 explicitly call this address a scam. Evidence is conclusive.',
    },
  },
  {
    delay: 13700,
    event: {
      type: 'verdict.rendered',
      verdict: {
        score: 94,
        label: 'LIKELY_RUG',
        confidence: 'high',
        reasons: [
          'Contract is unverified, blocking source-level review.',
          'Address is flagged on GoPlus with a high-severity cybercrime tag.',
          'Deployer is a serial issuer: 14 contracts in 30 days, 79% unverified.',
          'Funding traces back to Tornado Cash — privacy-mixer origin.',
          'On-platform sentiment includes explicit scam complaints.',
        ],
        evidence: [
          { source: 'BaseScan address', finding: 'Unverified contract, sparse history', costUsdc: '0.05' },
          { source: 'GoPlus + ScamSniffer', finding: 'Cybercrime hit (high severity)', costUsdc: '0.00' },
          { source: 'BaseScan deployer history', finding: '14 contracts in 30 days, 79% unverified', costUsdc: '0.08' },
          { source: 'MetaSleuth cluster', finding: 'Funded by Tornado Cash mixer', costUsdc: '0.10' },
          { source: 'X mentions', finding: '2 of 5 mentions explicitly flag as scam', costUsdc: '0.04' },
        ],
        durationSec: 14,
      },
    },
  },
  {
    delay: 14200,
    event: { type: 'codex.line', line: 'VERDICT: {"score":94,"label":"LIKELY_RUG","spent":"0.27"}' },
  },
  {
    delay: 14700,
    event: { type: 'investigation.completed', reason: 'verdict' },
  },
];

function stamp(event: UnstampedEvent): DashboardEvent {
  return { ...event, ts: new Date().toISOString() } as DashboardEvent;
}

export function useInvestigation() {
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [status, setStatus] = useState<InvestigationStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const timersRef = useRef<number[]>([]);

  const clearDemoTimers = useCallback(() => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current = [];
  }, []);

  const replaceEvents = useCallback((next: DashboardEvent[]) => {
    setEvents(next);
    window.localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(next));
  }, []);

  const pushEvent = useCallback((event: DashboardEvent) => {
    setEvents((prev) => {
      const next = [...prev, event];
      window.localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const updateStatus = useCallback((next: InvestigationStatus) => {
    setStatus(next);
    window.localStorage.setItem(STATUS_STORAGE_KEY, next);
  }, []);

  useEffect(() => {
    const storedEvents = window.localStorage.getItem(EVENTS_STORAGE_KEY);
    const storedStatus = window.localStorage.getItem(STATUS_STORAGE_KEY) as InvestigationStatus | null;
    if (storedEvents) {
      try {
        setEvents(JSON.parse(storedEvents) as DashboardEvent[]);
      } catch {
        window.localStorage.removeItem(EVENTS_STORAGE_KEY);
      }
    }
    if (storedStatus && ['idle', 'running', 'done', 'error'].includes(storedStatus)) {
      setStatus(storedStatus === 'running' ? 'idle' : storedStatus);
    }
  }, []);

  const start = useCallback(async (address: string) => {
    clearDemoTimers();
    replaceEvents([]);
    setError(null);
    updateStatus('running');
    try {
      const res = await fetch(`${ORCHESTRATOR}/investigations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { id } = (await res.json()) as { id: string };

      sourceRef.current?.close();
      const source = new EventSource(`${ORCHESTRATOR}/investigations/${id}/events`);
      sourceRef.current = source;
      source.onmessage = (e) => {
        const event = JSON.parse(e.data) as DashboardEvent;
        pushEvent(event);
        if (event.type === 'investigation.completed') {
          updateStatus('done');
          source.close();
        }
      };
      source.onerror = () => {
        updateStatus('error');
        setError('SSE connection lost');
        source.close();
      };
    } catch (err) {
      updateStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [clearDemoTimers, pushEvent, replaceEvents, updateStatus]);

  const runDemo = useCallback(() => {
    sourceRef.current?.close();
    clearDemoTimers();
    replaceEvents([]);
    setError(null);
    updateStatus('running');

    timersRef.current = demoTimeline.map(({ delay, event }) =>
      window.setTimeout(() => {
        const next = stamp(event);
        pushEvent(next);
        if (next.type === 'investigation.completed') updateStatus('done');
      }, delay),
    );
  }, [clearDemoTimers, pushEvent, replaceEvents, updateStatus]);

  return { start, runDemo, events, status, error };
}
