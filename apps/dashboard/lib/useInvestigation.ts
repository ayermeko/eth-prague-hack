// apps/dashboard/lib/useInvestigation.ts
'use client';
import { useCallback, useRef, useState } from 'react';

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
    };

const ORCHESTRATOR =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:4000';

export function useInvestigation() {
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  const start = useCallback(async (address: string) => {
    setEvents([]);
    setError(null);
    setStatus('running');
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
        setEvents((prev) => [...prev, event]);
        if (event.type === 'investigation.completed') {
          setStatus('done');
          source.close();
        }
      };
      source.onerror = () => {
        setStatus('error');
        setError('SSE connection lost');
        source.close();
      };
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  return { start, events, status, error };
}
