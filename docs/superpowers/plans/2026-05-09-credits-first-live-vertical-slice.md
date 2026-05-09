# Credits-First Live Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make RugSleuth run a real dashboard-to-Codex-to-MCP-to-Apify investigation using Apify credits now, while preserving the x402 path for the final bounty demo.

**Architecture:** Add a small Apify access abstraction inside `services/rugcheck-mcp`. Token mode uses `APIFY_TOKEN` to run the real Actor through Apify credits; x402 mode keeps using `@rugsleuth/x402-client`. The orchestrator passes only the env vars needed by the selected mode and does not require a wallet in token mode.

**Tech Stack:** Node.js 20, TypeScript, npm workspaces, Fastify, MCP SDK, Apify REST API, Vitest, Next.js dashboard.

---

## File Structure

- Modify `services/rugcheck-mcp/src/index.ts`: parse `APIFY_PAYMENT_MODE`, construct the correct client, and make wallet optional in token mode.
- Create `services/rugcheck-mcp/src/apify-client.ts`: define a shared Actor client interface plus token and x402 implementations.
- Modify `services/rugcheck-mcp/src/tools/scrape-basescan-address.ts`: depend on the shared Actor client instead of directly depending on x402.
- Modify `services/rugcheck-mcp/test/scrape-basescan-address.test.ts`: cover token-mode output and events.
- Create `services/rugcheck-mcp/test/apify-client.test.ts`: cover token auth, x402 delegation, and HTTP error behavior.
- Modify `services/orchestrator/src/index.ts`: parse token/x402 env modes and register MCP with the correct env vars.
- Add `services/orchestrator/src/config.ts`: parse orchestrator environment with token/x402 mode-aware validation.
- Add `services/orchestrator/test/config.test.ts`: cover token and x402 startup config behavior.
- Modify `.env.example`: document token mode as the default local path and x402 as later payment mode.

## Task 1: Add Shared Apify Actor Client

**Files:**
- Create: `services/rugcheck-mcp/src/apify-client.ts`
- Create: `services/rugcheck-mcp/test/apify-client.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `services/rugcheck-mcp/test/apify-client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createApifyActorClient, type ActorRunRequest } from '../src/apify-client.js';

const request: ActorRunRequest = {
  actorId: 'user/basescan-deep',
  input: { address: '0x1111111111111111111111111111111111111111' },
};

describe('createApifyActorClient', () => {
  it('runs an Actor with APIFY_TOKEN in token mode', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        'https://api.apify.com/v2/acts/user%2Fbasescan-deep/run-sync-get-dataset-items?token=apify_api_test',
      );
      expect(init?.method).toBe('POST');
      expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(init?.body).toBe(JSON.stringify(request.input));
      return new Response(JSON.stringify([{ ok: true }]), { status: 200 });
    });

    const client = createApifyActorClient({
      mode: 'token',
      apifyBaseUrl: 'https://api.apify.com',
      apifyToken: 'apify_api_test',
      fetch,
    });

    await expect(client.runActor(request)).resolves.toEqual({
      result: [{ ok: true }],
      payments: [],
    });
  });

  it('throws a useful error for token mode HTTP failures', async () => {
    const fetch = vi.fn(async () => new Response('bad actor input', { status: 400 }));
    const client = createApifyActorClient({
      mode: 'token',
      apifyBaseUrl: 'https://api.apify.com',
      apifyToken: 'apify_api_test',
      fetch,
    });

    await expect(client.runActor(request)).rejects.toThrow(
      'Apify token Actor call failed with 400: bad actor input',
    );
  });

  it('delegates to x402 client in x402 mode', async () => {
    const x402Client = {
      on: vi.fn(),
      fetch: vi.fn(async () => ({
        result: [{ paid: true }],
        payments: [{ status: 'settled', amountUsdc: '1.000000', payTo: '0x2222222222222222222222222222222222222222', ts: '2026-05-09T00:00:00.000Z' }],
      })),
    };

    const client = createApifyActorClient({
      mode: 'x402',
      apifyBaseUrl: 'https://api.apify.com',
      x402Client,
    });

    const result = await client.runActor(request);

    expect(result.result).toEqual([{ paid: true }]);
    expect(result.payments).toHaveLength(1);
    expect(x402Client.fetch).toHaveBeenCalledWith({
      url: 'https://api.apify.com/v2/acts/user%2Fbasescan-deep/run-sync-get-dataset-items',
      method: 'POST',
      body: request.input,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --workspace services/rugcheck-mcp test -- apify-client.test.ts
```

Expected: FAIL because `../src/apify-client.js` does not exist.

- [ ] **Step 3: Implement the client**

Create `services/rugcheck-mcp/src/apify-client.ts`:

```ts
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
    async runActor<T>(request): Promise<ActorRunResponse<T>> {
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
          `Apify token Actor call failed with ${response.status}${body ? `: ${body.slice(0, 240)}` : ''}`,
        );
      }

      return {
        result: (await response.json()) as T,
        payments: [],
      };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm --workspace services/rugcheck-mcp test -- apify-client.test.ts
```

Expected: PASS.

## Task 2: Refactor BaseScan Tool Onto Shared Client

**Files:**
- Modify: `services/rugcheck-mcp/src/tools/scrape-basescan-address.ts`
- Modify: `services/rugcheck-mcp/test/scrape-basescan-address.test.ts`

- [ ] **Step 1: Update the failing test**

Open `services/rugcheck-mcp/test/scrape-basescan-address.test.ts` and change the mocked input to pass `actorClient` instead of `client` and `apifyBaseUrl`. The core test setup should look like:

```ts
const actorClient = {
  runActor: vi.fn(async () => ({
    result: [
      {
        address: '0x1111111111111111111111111111111111111111',
        ethBalance: '0.5',
        isContract: true,
        verified: false,
        latestTxs: ['0xabc'],
        scrapedAt: '2026-05-09T00:00:00.000Z',
      },
    ],
    payments: [],
  })),
};

const result = await scrapeBasescanAddress({
  address: '0x1111111111111111111111111111111111111111',
  actorClient,
  actorId: 'user/basescan-deep',
});

expect(actorClient.runActor).toHaveBeenCalledWith({
  actorId: 'user/basescan-deep',
  input: { address: '0x1111111111111111111111111111111111111111' },
});
expect(result.verified).toBe(false);
expect(result.payments).toEqual([]);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --workspace services/rugcheck-mcp test -- scrape-basescan-address.test.ts
```

Expected: FAIL because the implementation still expects `client` and `apifyBaseUrl`.

- [ ] **Step 3: Update implementation**

Replace the input type and call site in `services/rugcheck-mcp/src/tools/scrape-basescan-address.ts`:

```ts
import type { PaymentEvent } from '@rugsleuth/x402-client';
import type { ApifyActorClient } from '../apify-client.js';
import { emit } from '../events.js';

export interface ScrapeBasescanAddressInput {
  address: string;
  actorClient: ApifyActorClient;
  actorId: string;
}
```

Replace the `client.fetch` call with:

```ts
const res = await actorClient.runActor<ApifyDatasetItems>({
  actorId,
  input: { address },
});
```

Remove `apifyBaseUrl` and `X402Client` imports from this file.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm --workspace services/rugcheck-mcp test -- scrape-basescan-address.test.ts
```

Expected: PASS.

## Task 3: Add MCP Env Mode Parsing

**Files:**
- Modify: `services/rugcheck-mcp/src/index.ts`

- [ ] **Step 1: Update MCP bootstrap code**

In `services/rugcheck-mcp/src/index.ts`, replace the current env schema and client construction with:

```ts
import { createApifyActorClient } from './apify-client.js';

const baseEnv = z.object({
  APIFY_PAYMENT_MODE: z.enum(['token', 'x402']).default('x402'),
  APIFY_BASE_URL: z.string().url().default('https://api.apify.com'),
  BASESCAN_DEEP_ACTOR_ID: z.string().min(1),
  APIFY_TOKEN: z.string().optional(),
  WALLET_PRIVATE_KEY: z.string().optional(),
});

const rawEnv = baseEnv.parse(process.env);

const actorClient =
  rawEnv.APIFY_PAYMENT_MODE === 'token'
    ? createApifyActorClient({
        mode: 'token',
        apifyBaseUrl: rawEnv.APIFY_BASE_URL,
        apifyToken: z.string().min(1, 'APIFY_TOKEN is required when APIFY_PAYMENT_MODE=token').parse(rawEnv.APIFY_TOKEN),
      })
    : createApifyActorClient({
        mode: 'x402',
        apifyBaseUrl: rawEnv.APIFY_BASE_URL,
        x402Client: createX402Client({
          privateKey: z
            .string()
            .regex(/^0x[a-fA-F0-9]{64}$/, 'WALLET_PRIVATE_KEY must be a 0x-prefixed 64-hex-char string')
            .parse(rawEnv.WALLET_PRIVATE_KEY) as `0x${string}`,
        }),
      });
```

Then update the tool call:

```ts
const result = await scrapeBasescanAddress({
  address: args.address,
  actorClient,
  actorId: rawEnv.BASESCAN_DEEP_ACTOR_ID,
});
```

- [ ] **Step 2: Run MCP tests**

Run:

```bash
npm --workspace services/rugcheck-mcp test
```

Expected: PASS after imports and types are fixed.

## Task 4: Make Orchestrator Token Mode Friendly

**Files:**
- Create: `services/orchestrator/src/config.ts`
- Modify: `services/orchestrator/src/index.ts`
- Create: `services/orchestrator/test/config.test.ts`

- [ ] **Step 1: Write failing config tests**

Create `services/orchestrator/test/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';

const baseEnv = {
  BASESCAN_DEEP_ACTOR_ID: 'user/basescan-deep',
};

describe('parseConfig', () => {
  it('accepts token mode without a wallet private key', () => {
    const config = parseConfig({
      ...baseEnv,
      APIFY_PAYMENT_MODE: 'token',
      APIFY_TOKEN: 'apify_api_test',
    });

    expect(config.APIFY_PAYMENT_MODE).toBe('token');
    expect(config.APIFY_TOKEN).toBe('apify_api_test');
    expect(config.WALLET_PRIVATE_KEY).toBeUndefined();
  });

  it('rejects token mode without APIFY_TOKEN', () => {
    expect(() =>
      parseConfig({
        ...baseEnv,
        APIFY_PAYMENT_MODE: 'token',
      }),
    ).toThrow('APIFY_TOKEN is required when APIFY_PAYMENT_MODE=token');
  });

  it('rejects x402 mode without WALLET_PRIVATE_KEY', () => {
    expect(() =>
      parseConfig({
        ...baseEnv,
        APIFY_PAYMENT_MODE: 'x402',
      }),
    ).toThrow('WALLET_PRIVATE_KEY is required when APIFY_PAYMENT_MODE=x402');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --workspace services/orchestrator test -- config.test.ts
```

Expected: FAIL because `../src/config.js` does not exist.

- [ ] **Step 3: Create config parser**

Create `services/orchestrator/src/config.ts`:

```ts
import { z } from 'zod';

export const configSchema = z
  .object({
    ORCHESTRATOR_PORT: z.coerce.number().default(4000),
    INVESTIGATION_BUDGET_USDC: z.coerce.number().default(2.0),
    INVESTIGATION_TIMEOUT_MS: z.coerce.number().default(180_000),
    CODEX_BIN: z.string().default('codex'),
    MCP_SERVER_NAME: z.string().default('rugsleuth'),
    BASESCAN_DEEP_ACTOR_ID: z.string(),
    APIFY_PAYMENT_MODE: z.enum(['token', 'x402']).default('x402'),
    APIFY_TOKEN: z.string().optional(),
    WALLET_PRIVATE_KEY: z.string().optional(),
    APIFY_BASE_URL: z.string().url().default('https://api.apify.com'),
    OPENAI_API_KEY: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.APIFY_PAYMENT_MODE === 'token' && !value.APIFY_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APIFY_TOKEN'],
        message: 'APIFY_TOKEN is required when APIFY_PAYMENT_MODE=token',
      });
    }
    if (
      value.APIFY_PAYMENT_MODE === 'x402' &&
      !/^0x[a-fA-F0-9]{64}$/.test(value.WALLET_PRIVATE_KEY ?? '')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WALLET_PRIVATE_KEY'],
        message: 'WALLET_PRIVATE_KEY is required when APIFY_PAYMENT_MODE=x402',
      });
    }
  });

export type OrchestratorConfig = z.infer<typeof configSchema>;

export function parseConfig(input: NodeJS.ProcessEnv): OrchestratorConfig {
  return configSchema.parse(input);
}
```

- [ ] **Step 4: Use config parser in index**

In `services/orchestrator/src/index.ts`, replace the direct `z` import and inline schema with:

```ts
import { parseConfig } from './config.js';
```

Then set:

```ts
const env = parseConfig(process.env);
```

- [ ] **Step 5: Pass correct env vars into `codex mcp add`**

Replace the hardcoded `execFileSync(env.CODEX_BIN, ['mcp', 'add', ...])` argument construction with a small array:

```ts
const mcpEnvArgs = [
  '--env',
  `APIFY_PAYMENT_MODE=${env.APIFY_PAYMENT_MODE}`,
  '--env',
  `BASESCAN_DEEP_ACTOR_ID=${env.BASESCAN_DEEP_ACTOR_ID}`,
  '--env',
  `APIFY_BASE_URL=${env.APIFY_BASE_URL}`,
];

if (env.APIFY_PAYMENT_MODE === 'token') {
  mcpEnvArgs.push('--env', `APIFY_TOKEN=${env.APIFY_TOKEN}`);
} else {
  mcpEnvArgs.push('--env', `WALLET_PRIVATE_KEY=${env.WALLET_PRIVATE_KEY}`);
}

execFileSync(
  env.CODEX_BIN,
  [
    'mcp',
    'add',
    env.MCP_SERVER_NAME,
    ...mcpEnvArgs,
    '--',
    'node',
    MCP_ENTRY,
  ],
  { stdio: 'pipe' },
);
```

- [ ] **Step 6: Run tests and build orchestrator**

Run:

```bash
npm --workspace services/orchestrator test -- config.test.ts
npm --workspace services/orchestrator run build
```

Expected: PASS.

## Task 5: Update Env Example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Replace env contents with token-first defaults**

Use:

```env
# Local live mode: real Apify Actor calls paid by your Apify account credits.
APIFY_PAYMENT_MODE=token
APIFY_TOKEN=apify_api_replace_me
BASESCAN_DEEP_ACTOR_ID=your-username/basescan-deep
APIFY_BASE_URL=https://api.apify.com

# Later bounty payment mode: real x402 USDC payments on Base.
# APIFY_PAYMENT_MODE=x402
# WALLET_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000000

# Optional: Codex CLI can also use subscription auth if already logged in.
OPENAI_API_KEY=sk-replace_me

ORCHESTRATOR_PORT=4000
INVESTIGATION_BUDGET_USDC=2.00
INVESTIGATION_TIMEOUT_MS=180000
NEXT_PUBLIC_ORCHESTRATOR_URL=http://localhost:4000
```

- [ ] **Step 2: Confirm real `.env.local` is ignored**

Run:

```bash
git status --short .env.local .env.example
```

Expected: `.env.local` is not shown as tracked or staged. `.env.example` may be modified.

## Task 6: Verify Workspace

**Files:**
- No new files.

- [ ] **Step 1: Run all relevant tests**

Run:

```bash
npm --workspace packages/x402-client test
npm --workspace services/rugcheck-mcp test
npm --workspace services/orchestrator test
```

Expected: all PASS.

- [ ] **Step 2: Build backend packages**

Run:

```bash
npm --workspace packages/x402-client run build
npm --workspace services/rugcheck-mcp run build
npm --workspace services/orchestrator run build
```

Expected: all PASS.

## Task 7: Local Live Smoke Test

**Files:**
- No committed code changes.

- [ ] **Step 1: Load env locally**

Use your local shell or a dotenv loader so the orchestrator sees:

```env
APIFY_PAYMENT_MODE=token
APIFY_TOKEN=<new rotated token>
BASESCAN_DEEP_ACTOR_ID=<your real actor id>
```

- [ ] **Step 2: Start orchestrator**

Run:

```bash
npm --workspace services/orchestrator run dev
```

Expected: server listens on `http://localhost:4000` and registers the `rugsleuth` MCP server without requiring `WALLET_PRIVATE_KEY`.

- [ ] **Step 3: Start dashboard**

In another terminal:

```bash
npm --workspace apps/dashboard run dev
```

Expected: dashboard listens on `http://localhost:3000`.

- [ ] **Step 4: Run a real address**

Paste a Base address that your Actor can scrape. Expected:

- UI status changes to running.
- Event stream shows `scrape_basescan_address` starting.
- Event stream shows successful tool completion.
- Codex prints a verdict or at least a completion line based on real Actor data.

## Self-Review

- Spec coverage: token mode, x402 preservation, env behavior, MCP data flow, and local smoke testing are covered.
- Placeholder scan: no `TBD` or unspecified implementation steps remain.
- Type consistency: the shared interface is `ApifyActorClient.runActor`, and the BaseScan tool consumes that interface consistently.
