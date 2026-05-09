import type { PaymentEvent, X402Client, X402Response } from '@rugsleuth/x402-client';

export type ApifyPaymentMode = 'token' | 'x402';

export interface ActorRunRequest {
  actorId: string;
  input: Record<string, unknown>;
}

export interface ActorRunResponse<T = unknown> {
  result: T;
  payments: PaymentEvent[];
}

export interface ApifyActorClient {
  runActor<T = unknown>(request: ActorRunRequest): Promise<ActorRunResponse<T>>;
}

export type CreateApifyActorClientOptions =
  | {
      mode: 'token';
      apifyBaseUrl: string;
      apifyToken: string;
      fetch?: typeof globalThis.fetch;
    }
  | {
      mode: 'x402';
      apifyBaseUrl: string;
      x402Client: X402Client;
    };

export function createApifyActorClient(options: CreateApifyActorClientOptions): ApifyActorClient {
  const baseUrl = options.apifyBaseUrl.replace(/\/$/, '');

  return {
    async runActor<T>(request: ActorRunRequest): Promise<ActorRunResponse<T>> {
      const url = `${baseUrl}/v2/acts/${encodeURIComponent(
        request.actorId,
      )}/run-sync-get-dataset-items`;

      if (options.mode === 'x402') {
        return (await options.x402Client.fetch<T>({
          url,
          method: 'POST',
          body: request.input,
        })) as X402Response<T>;
      }

      const fetchImpl = options.fetch ?? globalThis.fetch;
      const tokenUrl = `${url}?token=${encodeURIComponent(options.apifyToken)}`;
      const response = await fetchImpl(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.input),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
          `Apify token Actor call failed with ${response.status}${
            body ? `: ${body.slice(0, 240)}` : ''
          }`,
        );
      }

      return {
        result: (await response.json()) as T,
        payments: [],
      };
    },
  };
}
