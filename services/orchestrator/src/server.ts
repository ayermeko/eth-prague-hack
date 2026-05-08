import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { EventBus, InvestigationEvent } from './events.js';
import { Investigations, InvestigationsOptions } from './investigations.js';
import { parseAddress } from './validation.js';

export interface BuildServerOptions {
  bus: EventBus;
  investigations: Investigations;
}

export function buildServer(opts: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(cors, { origin: true });

  app.get('/health', async () => ({ ok: true }));

  app.post<{ Body: { address: string } }>('/investigations', async (req, reply) => {
    let address: string;
    try {
      address = parseAddress(req.body?.address ?? '');
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : 'invalid address' };
    }
    const id = await opts.investigations.start({ address });
    return { id };
  });

  app.get<{ Params: { id: string } }>('/investigations/:id/events', (req, reply) => {
    // Fastify would otherwise terminate the stream the moment this handler
    // returns. hijack() hands the raw socket to us so we own the lifecycle.
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Flush an initial comment so the browser sees the connection open
    // immediately even before the first real event arrives.
    reply.raw.write(': open\n\n');

    const send = (event: InvestigationEvent): void => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Idle keepalive — proxies and some browsers close streams after ~30s
    // of silence. Send a comment every 15s while the connection is open.
    const heartbeat = setInterval(() => {
      reply.raw.write(': ping\n\n');
    }, 15_000);

    const unsub = opts.bus.subscribe(req.params.id, send);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsub();
    });
  });

  return app;
}

export function spawnFactory(deps: {
  command: string;
  args: (ctx: { investigationId: string; address: string }) => string[];
  env: NodeJS.ProcessEnv;
  bus: EventBus;
  spawnCodex: typeof import('./codex.js').spawnCodex;
}): InvestigationsOptions['spawn'] {
  return async ({ investigationId, address }) => {
    const run = await deps.spawnCodex({
      investigationId,
      bus: deps.bus,
      command: deps.command,
      args: deps.args({ investigationId, address }),
      env: deps.env,
    });
    return { kill: run.kill, exit: run.exit };
  };
}
