// services/orchestrator/src/codex.ts
import { spawn, ChildProcess } from 'node:child_process';
import { EventBus, VerdictLabel, VerdictPayload } from './events.js';

const RSEVT = 'RSEVT ';
const VERDICT = 'VERDICT:';
const ALLOWED_LABELS: ReadonlySet<VerdictLabel> = new Set([
  'LIKELY_RUG',
  'SUSPICIOUS',
  'INCONCLUSIVE',
  'LIKELY_LEGIT',
]);
const ALLOWED_CONFIDENCE = new Set(['low', 'medium', 'high'] as const);

export interface SpawnCodexOptions {
  investigationId: string;
  bus: EventBus;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export interface SpawnCodexHandle {
  child: ChildProcess;
  exit: Promise<number>;
  kill: () => void;
}

// Defensive parser: Codex is asked to print a single JSON object after the
// VERDICT: prefix. We accept partial structures and fill missing fields with
// safe defaults so the dashboard always has something to render.
export function tryParseVerdict(line: string): VerdictPayload | null {
  if (!line.startsWith(VERDICT)) return null;
  const jsonText = line.slice(VERDICT.length).trim();
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const score =
    typeof r.score === 'number' && Number.isFinite(r.score)
      ? Math.max(0, Math.min(100, Math.round(r.score)))
      : 0;
  const label = ALLOWED_LABELS.has(r.label as VerdictLabel)
    ? (r.label as VerdictLabel)
    : 'INCONCLUSIVE';
  const confidence = ALLOWED_CONFIDENCE.has(r.confidence as 'low' | 'medium' | 'high')
    ? (r.confidence as 'low' | 'medium' | 'high')
    : 'low';
  const reasons = Array.isArray(r.reasons)
    ? r.reasons.filter((x): x is string => typeof x === 'string')
    : [];
  const evidence = Array.isArray(r.evidence)
    ? r.evidence
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .map((row) => ({
          source: typeof row.source === 'string' ? row.source : 'unknown',
          finding: typeof row.finding === 'string' ? row.finding : '',
          costUsdc: typeof row.costUsdc === 'string' ? row.costUsdc : '0.00',
        }))
    : [];
  const durationSec =
    typeof r.durationSec === 'number' && Number.isFinite(r.durationSec)
      ? Math.max(0, Math.round(r.durationSec))
      : 0;

  return { score, label, confidence, reasons, evidence, durationSec };
}

export async function spawnCodex(opts: SpawnCodexOptions): Promise<SpawnCodexHandle> {
  const child = spawn(opts.command, opts.args, {
    env: { ...process.env, ...opts.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const lineEmitter = (chunk: Buffer | string, kind: 'stdout' | 'stderr'): void => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.replace(/\r$/, '');
      if (!trimmed) continue;
      const ts = new Date().toISOString();
      if (kind === 'stderr' && trimmed.startsWith(RSEVT)) {
        try {
          const payload = JSON.parse(trimmed.slice(RSEVT.length));
          opts.bus.publish(opts.investigationId, { type: 'mcp.event', ts, payload });
          continue;
        } catch {
          // fall through and treat as a regular line
        }
      }
      // Surface the raw line first so EventFeed shows the agent's last word,
      // then publish the structured verdict for VerdictCard.
      opts.bus.publish(opts.investigationId, { type: 'codex.line', line: trimmed, ts });
      if (kind === 'stdout') {
        const verdict = tryParseVerdict(trimmed);
        if (verdict) {
          opts.bus.publish(opts.investigationId, {
            type: 'verdict.rendered',
            ts,
            verdict,
          });
        }
      }
    }
  };

  child.stdout?.on('data', (c) => lineEmitter(c, 'stdout'));
  child.stderr?.on('data', (c) => lineEmitter(c, 'stderr'));

  const exit = new Promise<number>((resolve) => {
    child.on('close', (code) => resolve(code ?? 0));
  });

  return {
    child,
    exit,
    kill: () => {
      if (!child.killed) child.kill('SIGTERM');
    },
  };
}
