// services/orchestrator/src/codex.ts
import { spawn, ChildProcess } from 'node:child_process';
import { EventBus } from './events.js';

const RSEVT = 'RSEVT ';

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
      // Stderr is reserved for our RSEVT structured events (from the MCP
      // server) and a small set of error-ish lines worth surfacing.
      // Codex's own stderr is dominated by routine logger output (model-list
      // refresh failures, telemetry) that floods the dashboard if forwarded.
      if (kind === 'stderr') {
        if (trimmed.startsWith(RSEVT)) {
          try {
            const payload = JSON.parse(trimmed.slice(RSEVT.length));
            opts.bus.publish(opts.investigationId, { type: 'mcp.event', ts, payload });
          } catch {
            // malformed RSEVT line — drop it
          }
        }
        continue;
      }
      opts.bus.publish(opts.investigationId, { type: 'codex.line', line: trimmed, ts });
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
