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

    let completed = false;
    const finish = (reason: 'verdict' | 'timeout' | 'budget' | 'error') => {
      if (completed) return;
      completed = true;
      this.bus.publish(id, {
        type: 'investigation.completed',
        reason,
        ts: new Date().toISOString(),
      });
    };

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
          finish('budget');
          off();
        }
      }
    });

    const timer = setTimeout(() => {
      run.kill();
      finish('timeout');
      off();
    }, this.opts.timeoutMs);

    run.exit
      .then((code) => {
        clearTimeout(timer);
        off();
        this.active.delete(id);
        finish(code === 0 ? 'verdict' : 'error');
      })
      .catch(() => {
        clearTimeout(timer);
        off();
        this.active.delete(id);
        finish('error');
      });

    return id;
  }
}
