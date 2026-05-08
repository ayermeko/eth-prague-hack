import { randomUUID } from 'node:crypto';
import { EventBus } from './events.js';

export interface SpawnedRun {
  kill: () => void;
  exit: Promise<number>;
}

export interface InvestigationsOptions {
  spawn: (ctx: {
    investigationId: string;
    address: string;
  }) => Promise<SpawnedRun>;
  budgetUsdc: number;
  timeoutMs: number;
}

export interface StartInput {
  address: string;
}

export class Investigations {
  private readonly active = new Map<string, SpawnedRun>();

  constructor(private readonly bus: EventBus, private readonly opts: InvestigationsOptions) {}

  async start(input: StartInput): Promise<string> {
    const id = randomUUID();
    const run = await this.opts.spawn({ investigationId: id, address: input.address });
    this.active.set(id, run);

    let spent = 0;
    const off = this.bus.subscribe(id, (event) => {
      if (
        event.type === 'mcp.event' &&
        event.payload.kind === 'payment' &&
        event.payload.status === 'settled'
      ) {
        spent += Number.parseFloat(event.payload.amountUsdc);
        if (spent > this.opts.budgetUsdc) {
          this.bus.publish(id, {
            type: 'budget.exceeded',
            spentUsdc: spent.toFixed(4),
            ts: new Date().toISOString(),
          });
          run.kill();
          this.bus.publish(id, {
            type: 'investigation.completed',
            reason: 'budget',
            ts: new Date().toISOString(),
          });
          off();
        }
      }
    });

    const timer = setTimeout(() => {
      run.kill();
      this.bus.publish(id, {
        type: 'investigation.completed',
        reason: 'timeout',
        ts: new Date().toISOString(),
      });
      off();
    }, this.opts.timeoutMs);

    run.exit
      .then(() => {
        clearTimeout(timer);
        this.active.delete(id);
      })
      .catch(() => {
        clearTimeout(timer);
        this.active.delete(id);
      });

    return id;
  }
}
