// services/orchestrator/test/codex.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { spawnCodex } from '../src/codex.js';
import { EventBus, InvestigationEvent } from '../src/events.js';

describe('spawnCodex', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

  it('streams stdout as codex.line and stderr RSEVT lines as mcp.event', async () => {
    const bus = new EventBus();
    const collected: InvestigationEvent[] = [];
    const unsub = bus.subscribe('inv-1', (e) => collected.push(e));
    cleanups.push(unsub);

    const fakeBinary =
      'echo plan; echo "RSEVT {\\"kind\\":\\"tool.start\\",\\"tool\\":\\"x\\",\\"args\\":{}}" 1>&2; echo done';
    const proc = await spawnCodex({
      investigationId: 'inv-1',
      bus,
      command: 'sh',
      args: ['-c', fakeBinary],
      env: {},
    });

    const exit = await proc.exit;
    expect(exit).toBe(0);

    expect(collected.some((e) => e.type === 'codex.line' && e.line === 'plan')).toBe(true);
    expect(
      collected.some(
        (e) => e.type === 'mcp.event' && e.payload.kind === 'tool.start' && e.payload.tool === 'x',
      ),
    ).toBe(true);
  });
});
