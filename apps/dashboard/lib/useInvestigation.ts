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
      line: 'Finding: contract is unverified and has very little transaction history. Buying deployer and liquidity signals next.',
    },
  },
  {
    delay: 5300,
    event: {
      type: 'mcp.event',
      payload: { kind: 'tool.start', tool: 'scrape_dexscreener_pair', args: { address: DEMO_ADDRESS } },
    },
  },
  {
    delay: 5900,
    event: {
      type: 'mcp.event',
      payload: {
        kind: 'payment',
        tool: 'scrape_dexscreener_pair',
        status: 'required',
        amountUsdc: '0.100000',
        payTo: '0x0000000000000000000000000000000000000bee',
        ppeEvent: 'pair-fetched',
      },
    },
  },
  {
    delay: 6500,
    event: {
      type: 'mcp.event',
      payload: {
        kind: 'payment',
        tool: 'scrape_dexscreener_pair',
        status: 'signed',
        amountUsdc: '0.100000',
        payTo: '0x0000000000000000000000000000000000000bee',
        ppeEvent: 'pair-fetched',
      },
    },
  },
  {
    delay: 7200,
    event: {
      type: 'mcp.event',
      payload: {
        kind: 'payment',
        tool: 'scrape_dexscreener_pair',
        status: 'settled',
        amountUsdc: '0.100000',
        payTo: '0x0000000000000000000000000000000000000bee',
        ppeEvent: 'pair-fetched',
      },
    },
  },
  {
    delay: 7600,
    event: {
      type: 'mcp.event',
      payload: { kind: 'tool.end', tool: 'scrape_dexscreener_pair', ok: true, ms: 1044 },
    },
  },
  {
    delay: 8400,
    event: {
      type: 'codex.line',
      line: 'Finding: liquidity is thin, LP is not locked, and the deployer has repeated launches in the last 30 days.',
    },
  },
  {
    delay: 9200,
    event: {
      type: 'mcp.event',
      payload: { kind: 'tool.start', tool: 'scrape_twitter_profile', args: { handle: 'BaseMoonDemo' } },
    },
  },
  {
    delay: 9800,
    event: {
      type: 'mcp.event',
      payload: {
        kind: 'payment',
        tool: 'scrape_twitter_profile',
        status: 'settled',
        amountUsdc: '0.300000',
        payTo: '0x0000000000000000000000000000000000000bee',
        ppeEvent: 'profile-fetched',
      },
    },
  },
  {
    delay: 10400,
    event: {
      type: 'mcp.event',
      payload: { kind: 'tool.end', tool: 'scrape_twitter_profile', ok: true, ms: 1288 },
    },
  },
  {
    delay: 11200,
    event: {
      type: 'codex.line',
      line: 'Decision: evidence is strong enough. Stop spending and render a verdict.',
    },
  },
  {
    delay: 12000,
    event: {
      type: 'verdict.rendered',
      verdict: {
        score: 92,
        label: 'LIKELY_RUG',
        confidence: 'high',
        reasons: [
          'Contract is unverified, which blocks source-level review.',
          'Liquidity is thin and the LP is not locked.',
          'Deployer pattern matches repeated short-lived launches.',
          'Social account is newly created with low-quality activity.',
        ],
        evidence: [
          { source: 'BaseScan', finding: 'Unverified contract and sparse history', costUsdc: '0.05' },
          { source: 'Dexscreener', finding: 'Thin unlocked liquidity', costUsdc: '0.10' },
          { source: 'Social scrape', finding: 'Fresh profile with weak signal quality', costUsdc: '0.30' },
        ],
        durationSec: 72,
      },
    },
  },
  {
    delay: 12600,
    event: { type: 'codex.line', line: 'VERDICT: {"score":92,"label":"LIKELY_RUG","spent":"0.45"}' },
  },
  {
    delay: 13100,
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
