// services/rugcheck-mcp/src/events.ts

import { appendFileSync } from 'node:fs';

// Every line on stderr that begins with `RSEVT ` is a JSON event consumed by
// the orchestrator. stdout is reserved for the MCP protocol.
const PREFIX = 'RSEVT ';

// Codex captures the MCP child's stderr internally, so RSEVT lines on stderr
// alone don't reach our orchestrator. As a side-channel, also append each
// event to the JSONL file pointed at by RUGSLEUTH_EVENTS_FILE if set.
// The orchestrator tails that file and forwards events to the SSE stream.
const EVENTS_FILE = process.env.RUGSLEUTH_EVENTS_FILE ?? '';

export type McpEvent =
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

export function emit(event: McpEvent): void {
  const line = `${PREFIX}${JSON.stringify(event)}\n`;
  process.stderr.write(line);
  if (EVENTS_FILE) {
    try {
      appendFileSync(EVENTS_FILE, line, { encoding: 'utf8' });
    } catch {
      // best-effort side-channel; never block tool execution on log writes
    }
  }
}

export const EVENT_PREFIX = PREFIX;
