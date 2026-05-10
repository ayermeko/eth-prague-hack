// services/rugcheck-mcp/src/events.ts

// Every line on stderr that begins with `RSEVT ` is a JSON event consumed by
// the orchestrator. stdout is reserved for the MCP protocol.
const PREFIX = 'RSEVT ';

export type McpEvent =
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

export function emit(event: McpEvent): void {
  process.stderr.write(`${PREFIX}${JSON.stringify(event)}\n`);
}

export const EVENT_PREFIX = PREFIX;
