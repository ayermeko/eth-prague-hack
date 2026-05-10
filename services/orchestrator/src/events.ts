// services/orchestrator/src/events.ts
export type VerdictLabel =
  | 'LIKELY_RUG'
  | 'SUSPICIOUS'
  | 'INCONCLUSIVE'
  | 'LIKELY_LEGIT';

export interface VerdictPayload {
  score: number;
  label: VerdictLabel;
  confidence: 'low' | 'medium' | 'high';
  reasons: string[];
  evidence: Array<{ source: string; finding: string; costUsdc: string }>;
  durationSec: number;
}

export type InvestigationEvent =
  | { type: 'codex.line'; line: string; ts: string }
  | {
      type: 'mcp.event';
      ts: string;
      payload:
        | { kind: 'tool.start'; tool: string; args: Record<string, unknown> }
        | { kind: 'tool.end'; tool: string; ok: boolean; error?: string; ms: number; cached?: boolean }
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
  | { type: 'verdict.rendered'; ts: string; verdict: VerdictPayload }
  | { type: 'budget.exceeded'; spentUsdc: string; ts: string }
  | { type: 'investigation.completed'; reason: 'verdict' | 'timeout' | 'budget' | 'error'; ts: string };

type Listener = (event: InvestigationEvent) => void;

export class EventBus {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly history = new Map<string, InvestigationEvent[]>();

  publish(id: string, event: InvestigationEvent): void {
    const history = this.history.get(id) ?? [];
    history.push(event);
    this.history.set(id, history);
    for (const l of this.listeners.get(id) ?? []) l(event);
  }

  subscribe(id: string, listener: Listener): () => void {
    const set = this.listeners.get(id) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(id, set);
    for (const past of this.history.get(id) ?? []) listener(past);
    return () => {
      set.delete(listener);
    };
  }
}
