import { describe, expect, it, vi } from 'vitest';
import { Investigations } from '../src/investigations.js';
import { EventBus, InvestigationEvent } from '../src/events.js';

describe('Investigations', () => {
  it('terminates the run when accumulated USDC spend exceeds the budget', async () => {
    const bus = new EventBus();
    const kill = vi.fn();

    const inv = new Investigations(bus, {
      // never resolves on its own — budget terminates it
      spawn: async () => ({ kill, exit: new Promise<number>(() => {}) }),
      budgetUsdc: 0.1,
      timeoutMs: 60_000,
    });

    const id = await inv.start({ address: '0x' + 'a'.repeat(40) });
    const seen: InvestigationEvent[] = [];
    bus.subscribe(id, (e) => seen.push(e));

    // Simulate two payments that together exceed 0.10
    bus.publish(id, {
      type: 'mcp.event',
      ts: new Date().toISOString(),
      payload: {
        kind: 'payment',
        tool: 't',
        status: 'settled',
        amountUsdc: '0.06',
        payTo: '0x0',
      },
    });
    bus.publish(id, {
      type: 'mcp.event',
      ts: new Date().toISOString(),
      payload: {
        kind: 'payment',
        tool: 't',
        status: 'settled',
        amountUsdc: '0.06',
        payTo: '0x0',
      },
    });

    // Yield to let async budget watcher fire
    await new Promise((r) => setTimeout(r, 20));

    expect(kill).toHaveBeenCalled();
    expect(seen.some((e) => e.type === 'budget.exceeded')).toBe(true);
    expect(
      seen.some((e) => e.type === 'investigation.completed' && e.reason === 'budget'),
    ).toBe(true);
  });
});
