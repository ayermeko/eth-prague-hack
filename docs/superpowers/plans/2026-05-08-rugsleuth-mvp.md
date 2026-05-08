# RugSleuth MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a vertical slice of RugSleuth: paste a Base contract address → an autonomous Codex agent investigates it → makes at least one real x402 payment to a paid Apify Actor → returns a structured result rendered live on a dashboard.

**Architecture:** Monorepo (npm workspaces). A `packages/x402-client` library implements the x402 protocol with viem. An Apify Actor `actors/basescan-deep` is configured with PPE pricing so it is callable via x402. A `services/rugcheck-mcp` MCP server exposes one paid tool (`scrape_basescan_address`) to Codex. A `services/orchestrator` Fastify service spawns Codex CLI per investigation and streams its activity to a Next.js dashboard via SSE. End-to-end: address → Codex → MCP → x402 → Apify → result.

**Tech Stack:** Node.js 20, TypeScript 5, npm workspaces, vitest, viem, fastify, @modelcontextprotocol/sdk, Apify Actor SDK (Crawlee + Playwright), Next.js 15 + Tailwind, Codex CLI (GPT-5.x).

**Out of scope for this plan (deferred to Phase 2):** Twitter and Dexscreener tools, deployer/holders PPE events, full verdict heuristic, demo polish, recorded fallback. This plan exits when one tool, one PPE event, one real x402 payment, and a minimal UI are working end-to-end.

**Preconditions:**
- Working tree on branch `jstudnic`. Other unstaged files exist (AGENTS.md deletion, CLAUDE.md and hackaton.md untracked) — do not touch them.
- Codex CLI installed locally (`codex --version` succeeds).
- An Apify account with an API token (free tier is fine) for **publishing** `basescan-deep`. The agent itself does not use this token at runtime — it uses x402.
- A Base mainnet wallet funded with $5–$10 USDC; private key available for `WALLET_PRIVATE_KEY`.
- Node 20+, npm 10+.

---

## File Structure

Files this plan creates or modifies:

```
eth-prague-hack/
├── package.json                                NEW  (workspaces root)
├── tsconfig.base.json                          NEW
├── .nvmrc                                      NEW
├── .env.example                                NEW
├── .gitignore                                  MOD  (add node_modules, .env*, dist, .next)
│
├── actors/
│   └── basescan-deep/                          MOVED from basescan-scraper/
│       ├── .actor/
│       │   ├── actor.json                      MOD  (PPE event + pricing)
│       │   ├── input_schema.json               MOD  (single address input)
│       │   └── pricing_schema.json             NEW  (PPE pricing)
│       └── src/
│           ├── main.ts                         MOD
│           └── routes.ts                       MOD  (Actor.charge for PPE event)
│
├── packages/
│   └── x402-client/                            NEW
│       ├── package.json                        NEW
│       ├── tsconfig.json                       NEW
│       ├── vitest.config.ts                    NEW
│       ├── src/
│       │   ├── index.ts                        NEW  (public exports)
│       │   ├── types.ts                        NEW  (PaymentEvent, X402Client iface)
│       │   ├── client.ts                       NEW  (X402Client class)
│       │   └── signing.ts                      NEW  (EIP-712 helpers)
│       └── test/
│           ├── client.test.ts                  NEW
│           └── mock-server.ts                  NEW
│
├── services/
│   ├── rugcheck-mcp/                           NEW
│   │   ├── package.json                        NEW
│   │   ├── tsconfig.json                       NEW
│   │   ├── vitest.config.ts                    NEW
│   │   ├── src/
│   │   │   ├── index.ts                        NEW  (MCP server bootstrap)
│   │   │   ├── tools/
│   │   │   │   └── scrape-basescan-address.ts  NEW
│   │   │   └── events.ts                       NEW  (stderr JSON event log)
│   │   └── test/
│   │       └── scrape-basescan-address.test.ts NEW
│   │
│   └── orchestrator/                           NEW
│       ├── package.json                        NEW
│       ├── tsconfig.json                       NEW
│       ├── vitest.config.ts                    NEW
│       ├── src/
│       │   ├── index.ts                        NEW  (entry)
│       │   ├── server.ts                       NEW  (fastify build)
│       │   ├── investigations.ts               NEW  (registry + handlers)
│       │   ├── codex.ts                        NEW  (child process)
│       │   ├── events.ts                       NEW  (event bus)
│       │   └── validation.ts                   NEW  (address validation)
│       └── test/
│           ├── validation.test.ts              NEW
│           ├── investigations.test.ts          NEW
│           └── codex.test.ts                   NEW
│
└── apps/
    └── dashboard/                              NEW
        ├── package.json                        NEW
        ├── next.config.ts                      NEW
        ├── tsconfig.json                       NEW
        ├── tailwind.config.ts                  NEW
        ├── postcss.config.mjs                  NEW
        ├── app/
        │   ├── layout.tsx                      NEW
        │   ├── globals.css                     NEW
        │   └── page.tsx                        NEW
        ├── components/
        │   ├── AddressInput.tsx                NEW
        │   ├── EventFeed.tsx                   NEW
        │   └── VerdictCard.tsx                 NEW
        └── lib/
            └── useInvestigation.ts             NEW
```

**Boundary rules:**
- `x402-client` knows nothing about Codex, MCP, or UI. It is a pure library.
- `rugcheck-mcp` knows nothing about the orchestrator or UI. It speaks MCP on stdio and emits structured logs on stderr.
- `orchestrator` knows nothing about scraping internals — it spawns Codex, parses stderr lines, forwards SSE.
- `dashboard` knows nothing about Apify, viem, or Codex — it consumes a JSON event stream over SSE.

---

## Phase 0 — Repo Bootstrap

### Task 1: Convert repo to npm workspaces and migrate the existing scraper

**Files:**
- Create: `package.json` (workspace root)
- Create: `tsconfig.base.json`
- Create: `.nvmrc`
- Create: `.env.example`
- Modify: `.gitignore`
- Move: `basescan-scraper/` → `actors/basescan-deep/`

- [ ] **Step 1: Move the existing scraper into the new `actors/` directory**

```bash
mkdir -p actors
git mv basescan-scraper actors/basescan-deep
```

- [ ] **Step 2: Create the workspace root `package.json`**

```json
{
  "name": "rugsleuth",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=20" },
  "workspaces": [
    "packages/*",
    "services/*",
    "apps/*",
    "actors/*"
  ],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "build": "npm run build --workspaces --if-present",
    "lint": "npm run lint --workspaces --if-present",
    "dev:orchestrator": "npm --workspace services/orchestrator run dev",
    "dev:dashboard": "npm --workspace apps/dashboard run dev"
  }
}
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 4: Create `.nvmrc`**

```
20
```

- [ ] **Step 5: Create `.env.example`**

```
# Wallet for the agent (Base mainnet, funded with USDC)
WALLET_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000000

# OpenAI key consumed by Codex CLI
OPENAI_API_KEY=sk-...

# Apify endpoints (override only for testing)
APIFY_BASE_URL=https://api.apify.com

# Orchestrator
ORCHESTRATOR_PORT=4000
INVESTIGATION_BUDGET_USDC=2.00
INVESTIGATION_TIMEOUT_MS=180000

# Dashboard
NEXT_PUBLIC_ORCHESTRATOR_URL=http://localhost:4000
```

- [ ] **Step 6: Append to `.gitignore`**

Append these lines (do not delete existing entries):

```
# RugSleuth
node_modules
dist
.next
.env
.env.local
*.log
```

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.base.json .nvmrc .env.example .gitignore actors/
git commit -m "chore: introduce workspaces, move basescan-scraper to actors/basescan-deep"
```

---

## Phase 1 — `x402-client` (TDD)

### Task 2: Package skeleton

**Files:**
- Create: `packages/x402-client/package.json`
- Create: `packages/x402-client/tsconfig.json`
- Create: `packages/x402-client/vitest.config.ts`

- [ ] **Step 1: `packages/x402-client/package.json`**

```json
{
  "name": "@rugsleuth/x402-client",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "viem": "^2.21.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.0.0"
  }
}
```

- [ ] **Step 2: `packages/x402-client/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: `packages/x402-client/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Install workspace dependencies**

```bash
npm install --workspace packages/x402-client
```

### Task 3: Define types and public surface

**Files:**
- Create: `packages/x402-client/src/types.ts`
- Create: `packages/x402-client/src/index.ts`

- [ ] **Step 1: `packages/x402-client/src/types.ts`**

```ts
export type PaymentStatus = 'required' | 'signed' | 'settled' | 'failed';

export interface PaymentEvent {
  id: string;
  status: PaymentStatus;
  amountUsdc: string;
  payTo: string;
  ppeEvent?: string;
  prepaidRef?: string;
  txHash?: string;
  ts: string;
  error?: string;
}

export interface X402Request {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
}

export interface X402Response<T = unknown> {
  result: T;
  payments: PaymentEvent[];
}

export type PaymentListener = (event: PaymentEvent) => void;

export interface X402ClientOptions {
  privateKey: `0x${string}`;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  randomId?: () => string;
}
```

- [ ] **Step 2: `packages/x402-client/src/index.ts`**

```ts
export { createX402Client } from './client.js';
export type {
  PaymentEvent,
  PaymentStatus,
  PaymentListener,
  X402Request,
  X402Response,
  X402ClientOptions,
} from './types.js';
```

### Task 4: Mock x402 server fixture for tests

**Files:**
- Create: `packages/x402-client/test/mock-server.ts`

- [ ] **Step 1: Build a deterministic in-memory mock server we can `fetch()` against**

```ts
// packages/x402-client/test/mock-server.ts
import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { AddressInfo } from 'node:net';

export interface MockBehavior {
  // First call to a path: respond with 402; subsequent calls: 200
  // unless `alwaysFree` includes the path.
  alwaysFree?: string[];
  // PPE event name to advertise in 402 response
  ppeEvent?: string;
  // amount in USDC decimal string
  amountUsdc?: string;
  // pay-to recipient address
  payTo?: string;
  // result body to return on settled 200
  resultBody?: unknown;
  // force every call to fail signing verification (for error tests)
  rejectSignatures?: boolean;
}

export interface MockServerHandle {
  url: string;
  close: () => Promise<void>;
  callsByPath: Record<string, number>;
  prepaidByCaller: Record<string, number>;
}

export async function startMockServer(behavior: MockBehavior = {}): Promise<MockServerHandle> {
  const callsByPath: Record<string, number> = {};
  const prepaidByCaller: Record<string, number> = {};
  const ppeEvent = behavior.ppeEvent ?? 'address-fetched';
  const amountUsdc = behavior.amountUsdc ?? '0.05';
  const payTo = behavior.payTo ?? '0x0000000000000000000000000000000000000bee';
  const resultBody = behavior.resultBody ?? { ok: true };

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    callsByPath[url] = (callsByPath[url] ?? 0) + 1;

    const isFree = behavior.alwaysFree?.includes(url) ?? false;
    if (isFree) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resultBody));
      return;
    }

    const protocolHeader = req.headers['x-apify-payment-protocol'];
    const signature = req.headers['payment-signature'];
    const callerKey = (req.headers['x-test-caller'] as string) ?? 'default';

    if (!protocolHeader || protocolHeader !== 'X402') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'X402 header required' }));
      return;
    }

    // Drawdown if prepaid balance exists
    if ((prepaidByCaller[callerKey] ?? 0) > 0) {
      prepaidByCaller[callerKey] = (prepaidByCaller[callerKey] ?? 0) - 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resultBody));
      return;
    }

    // No signature → emit 402
    if (!signature) {
      const required = JSON.stringify({
        scheme: 'eip712',
        chainId: 8453,
        verifyingContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        amountUsdc,
        payTo,
        ppeEvent,
        nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        validUntil: new Date(Date.now() + 60_000).toISOString(),
      });
      res.writeHead(402, {
        'Content-Type': 'application/json',
        'PAYMENT-REQUIRED': required,
      });
      res.end(JSON.stringify({ error: 'Payment required' }));
      return;
    }

    // Signature provided
    if (behavior.rejectSignatures) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad signature' }));
      return;
    }

    // Top up prepaid (5 free calls per signed payment to mirror Apify model)
    prepaidByCaller[callerKey] = (prepaidByCaller[callerKey] ?? 0) + 5;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(resultBody));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    callsByPath,
    prepaidByCaller,
  };
}
```

### Task 5: Test — pass-through on non-402 response (TDD)

**Files:**
- Create: `packages/x402-client/test/client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/x402-client/test/client.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createX402Client } from '../src/index.js';
import { startMockServer, MockServerHandle } from './mock-server.js';

const TEST_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const; // anvil #0

describe('x402-client', () => {
  let mock: MockServerHandle;

  beforeEach(async () => {
    mock = await startMockServer({ alwaysFree: ['/free'] });
  });

  afterEach(async () => {
    await mock.close();
  });

  it('passes through on a 200 response with no payment', async () => {
    const client = createX402Client({ privateKey: TEST_KEY });
    const res = await client.fetch({ url: `${mock.url}/free` });

    expect(res.payments).toEqual([]);
    expect(res.result).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
npm --workspace packages/x402-client run test
```

Expected: **FAIL** — `Cannot find module '../src/index.js'` (or `createX402Client is not a function`).

- [ ] **Step 3: Implement minimal pass-through client to make this test pass**

Create `packages/x402-client/src/client.ts`:

```ts
import type {
  PaymentEvent,
  PaymentListener,
  X402ClientOptions,
  X402Request,
  X402Response,
} from './types.js';

export interface X402Client {
  fetch<T = unknown>(req: X402Request): Promise<X402Response<T>>;
  on(event: 'payment', listener: PaymentListener): void;
}

export function createX402Client(opts: X402ClientOptions): X402Client {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const listeners: PaymentListener[] = [];

  return {
    on(_event, listener) {
      listeners.push(listener);
    },
    async fetch<T>(req: X402Request): Promise<X402Response<T>> {
      const headers: Record<string, string> = {
        'X-APIFY-PAYMENT-PROTOCOL': 'X402',
        'Content-Type': 'application/json',
        ...(req.headers ?? {}),
      };
      const init: RequestInit = {
        method: req.method ?? 'GET',
        headers,
        body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      };
      const response = await fetchImpl(req.url, init);
      if (response.status === 200) {
        const result = (await response.json()) as T;
        return { result, payments: [] };
      }
      throw new Error(`x402-client: unhandled status ${response.status}`);
    },
  };
}

// Suppress unused warning until used in later tasks
export const _internalListenersUnusedYet = (_: PaymentEvent[]): PaymentListener[] => [];
```

- [ ] **Step 4: Run test, expect pass**

```bash
npm --workspace packages/x402-client run test
```

Expected: **PASS** for `passes through on a 200 response with no payment`.

### Task 6: Test — 402 → sign → resend → 200 (TDD)

**Files:**
- Modify: `packages/x402-client/test/client.test.ts`
- Create: `packages/x402-client/src/signing.ts`
- Modify: `packages/x402-client/src/client.ts`

- [ ] **Step 1: Add the failing test**

Append to `client.test.ts`:

```ts
it('handles 402 by signing the challenge and resending', async () => {
  const client = createX402Client({ privateKey: TEST_KEY });
  const res = await client.fetch({ url: `${mock.url}/scrape` });

  expect(res.result).toEqual({ ok: true });
  expect(res.payments.length).toBe(3);
  expect(res.payments.map((p) => p.status)).toEqual(['required', 'signed', 'settled']);
  expect(res.payments[0]!.amountUsdc).toBe('0.05');
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
npm --workspace packages/x402-client run test
```

Expected: **FAIL** — `unhandled status 402`.

- [ ] **Step 3: Implement EIP-712 signing**

Create `packages/x402-client/src/signing.ts`:

```ts
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

export interface PaymentChallenge {
  scheme: 'eip712';
  chainId: number;
  verifyingContract: Hex;
  amountUsdc: string;
  payTo: Hex;
  ppeEvent: string;
  nonce: string;
  validUntil: string;
}

export interface SigningResult {
  signature: Hex;
  challenge: PaymentChallenge;
}

export function parseChallenge(headerValue: string): PaymentChallenge {
  const parsed = JSON.parse(headerValue) as PaymentChallenge;
  if (parsed.scheme !== 'eip712') {
    throw new Error(`Unsupported x402 scheme: ${String(parsed.scheme)}`);
  }
  return parsed;
}

export async function signChallenge(privateKey: Hex, challenge: PaymentChallenge): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);

  const domain = {
    name: 'Apify x402',
    version: '1',
    chainId: challenge.chainId,
    verifyingContract: challenge.verifyingContract,
  } as const;

  const types = {
    Payment: [
      { name: 'amountUsdc', type: 'string' },
      { name: 'payTo', type: 'address' },
      { name: 'ppeEvent', type: 'string' },
      { name: 'nonce', type: 'string' },
      { name: 'validUntil', type: 'string' },
    ],
  } as const;

  return account.signTypedData({
    domain,
    types,
    primaryType: 'Payment',
    message: {
      amountUsdc: challenge.amountUsdc,
      payTo: challenge.payTo,
      ppeEvent: challenge.ppeEvent,
      nonce: challenge.nonce,
      validUntil: challenge.validUntil,
    },
  });
}
```

> **Verification note:** The exact `domain` and `types` of Apify's EIP-712 challenge must be confirmed against `https://docs.apify.com/platform/integrations/x402` before we go live. If the challenge structure differs, update both `parseChallenge` and `signChallenge`. The mock-server harness above is intentionally tolerant so it does not gate this verification.

- [ ] **Step 4: Wire signing into the client**

Replace the body of `packages/x402-client/src/client.ts`:

```ts
import type {
  PaymentEvent,
  PaymentListener,
  X402ClientOptions,
  X402Request,
  X402Response,
} from './types.js';
import { parseChallenge, signChallenge } from './signing.js';

export interface X402Client {
  fetch<T = unknown>(req: X402Request): Promise<X402Response<T>>;
  on(event: 'payment', listener: PaymentListener): void;
}

const PAYMENT_PROTOCOL = 'X402';
const HEADER_PROTOCOL = 'X-APIFY-PAYMENT-PROTOCOL';
const HEADER_SIGNATURE = 'PAYMENT-SIGNATURE';
const HEADER_REQUIRED = 'PAYMENT-REQUIRED';

export function createX402Client(opts: X402ClientOptions): X402Client {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const now = opts.now ?? (() => new Date());
  const randomId = opts.randomId ?? (() => Math.random().toString(36).slice(2));
  const listeners: PaymentListener[] = [];

  function emit(events: PaymentEvent[], event: PaymentEvent): void {
    events.push(event);
    for (const l of listeners) l(event);
  }

  async function send(req: X402Request, signature?: string): Promise<Response> {
    const headers: Record<string, string> = {
      [HEADER_PROTOCOL]: PAYMENT_PROTOCOL,
      'Content-Type': 'application/json',
      ...(req.headers ?? {}),
    };
    if (signature) headers[HEADER_SIGNATURE] = signature;
    return fetchImpl(req.url, {
      method: req.method ?? 'GET',
      headers,
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
    });
  }

  async function readJson<T>(response: Response): Promise<T> {
    return (await response.json()) as T;
  }

  return {
    on(_event, listener) {
      listeners.push(listener);
    },

    async fetch<T>(req: X402Request): Promise<X402Response<T>> {
      const payments: PaymentEvent[] = [];
      const first = await send(req);

      if (first.status === 200) {
        return { result: await readJson<T>(first), payments };
      }

      if (first.status !== 402) {
        throw new Error(`x402-client: unexpected status ${first.status}`);
      }

      const requiredHeader = first.headers.get(HEADER_REQUIRED);
      if (!requiredHeader) {
        throw new Error('x402-client: 402 without PAYMENT-REQUIRED header');
      }

      const challenge = parseChallenge(requiredHeader);
      const requiredEvent: PaymentEvent = {
        id: randomId(),
        status: 'required',
        amountUsdc: challenge.amountUsdc,
        payTo: challenge.payTo,
        ppeEvent: challenge.ppeEvent,
        ts: now().toISOString(),
      };
      emit(payments, requiredEvent);

      let signature: string;
      try {
        signature = await signChallenge(opts.privateKey, challenge);
      } catch (err) {
        const failed: PaymentEvent = {
          ...requiredEvent,
          id: randomId(),
          status: 'failed',
          ts: now().toISOString(),
          error: err instanceof Error ? err.message : String(err),
        };
        emit(payments, failed);
        throw err;
      }

      emit(payments, {
        ...requiredEvent,
        id: randomId(),
        status: 'signed',
        ts: now().toISOString(),
      });

      const second = await send(req, signature);
      if (second.status !== 200) {
        const failed: PaymentEvent = {
          ...requiredEvent,
          id: randomId(),
          status: 'failed',
          ts: now().toISOString(),
          error: `Resend returned ${second.status}`,
        };
        emit(payments, failed);
        throw new Error(`x402-client: resend returned ${second.status}`);
      }

      emit(payments, {
        ...requiredEvent,
        id: randomId(),
        status: 'settled',
        ts: now().toISOString(),
      });

      return { result: await readJson<T>(second), payments };
    },
  };
}
```

- [ ] **Step 5: Run tests, expect both to pass**

```bash
npm --workspace packages/x402-client run test
```

Expected: **PASS** for both tests.

### Task 7: Test — prepaid drawdown after first signature (TDD)

**Files:**
- Modify: `packages/x402-client/test/client.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `client.test.ts`:

```ts
it('reuses prepaid balance: only the first call signs', async () => {
  const client = createX402Client({ privateKey: TEST_KEY });

  const first = await client.fetch({ url: `${mock.url}/scrape`, headers: { 'X-Test-Caller': 'a' } });
  const second = await client.fetch({ url: `${mock.url}/scrape`, headers: { 'X-Test-Caller': 'a' } });

  expect(first.payments.map((p) => p.status)).toEqual(['required', 'signed', 'settled']);
  expect(second.payments).toEqual([]); // pure prepaid drawdown
  expect(second.result).toEqual({ ok: true });
});
```

- [ ] **Step 2: Run tests, expect pass without code changes**

```bash
npm --workspace packages/x402-client run test
```

Expected: **PASS**. The mock server already implements prepaid drawdown; the client returns `payments: []` when the first response is 200.

### Task 8: Test — failure path emits `payment.failed` (TDD)

**Files:**
- Modify: `packages/x402-client/test/client.test.ts`

- [ ] **Step 1: Add a failing test for signature rejection**

Append to `client.test.ts`:

```ts
it('emits payment.failed when the resigned request is rejected', async () => {
  const rejectingMock = await startMockServer({ rejectSignatures: true });
  try {
    const client = createX402Client({ privateKey: TEST_KEY });
    let captured: { status: string; error?: string } | null = null;
    client.on('payment', (e) => {
      if (e.status === 'failed') captured = { status: e.status, error: e.error };
    });

    await expect(client.fetch({ url: `${rejectingMock.url}/scrape` })).rejects.toThrow();
    expect(captured).not.toBeNull();
    expect(captured!.status).toBe('failed');
  } finally {
    await rejectingMock.close();
  }
});
```

- [ ] **Step 2: Run, expect pass**

```bash
npm --workspace packages/x402-client run test
```

Expected: **PASS** — the existing client code already emits `payment.failed` on resend non-200.

### Task 9: Build, lint, commit

- [ ] **Step 1: Build the package**

```bash
npm --workspace packages/x402-client run build
```

Expected: clean compile, `packages/x402-client/dist/` is populated.

- [ ] **Step 2: Commit**

```bash
git add packages/x402-client package.json package-lock.json
git commit -m "feat(x402-client): EIP-712 signing, prepaid reuse, payment events"
```

---

## Phase 2 — `basescan-deep` Actor with PPE pricing

### Task 10: Configure PPE pricing on the Actor

**Files:**
- Modify: `actors/basescan-deep/.actor/actor.json`
- Create: `actors/basescan-deep/.actor/pricing_schema.json`
- Modify: `actors/basescan-deep/.actor/input_schema.json`

- [ ] **Step 1: Replace `actors/basescan-deep/.actor/actor.json`**

```json
{
  "$schema": "https://apify.com/schemas/v1/actor.ide.json",
  "actorSpecification": 1,
  "name": "basescan-deep",
  "title": "BaseScan Deep (RugSleuth)",
  "description": "Pay-Per-Event BaseScan scraper for the RugSleuth investigator agent.",
  "version": "0.1",
  "meta": {
    "templateId": "ts-crawlee-playwright-chrome",
    "generatedBy": "Claude Opus 4.7"
  },
  "input": "./input_schema.json",
  "output": "./output_schema.json",
  "storages": {
    "dataset": "./dataset_schema.json"
  },
  "pricingInfos": [
    {
      "pricingModel": "PAY_PER_EVENT",
      "pricingPerEvent": {
        "actorChargeEvents": {
          "address-fetched": {
            "eventTitle": "Address fetched",
            "eventDescription": "One BaseScan address page scraped (balance, contract status, recent txs).",
            "eventPriceUsd": 0.05
          }
        }
      }
    }
  ],
  "dockerfile": "../Dockerfile"
}
```

- [ ] **Step 2: Create `actors/basescan-deep/.actor/pricing_schema.json`** (kept for documentation; the canonical pricing lives in `actor.json` above)

```json
{
  "$schema": "https://apify.com/schemas/v1/pricing.ide.json",
  "pricingModel": "PAY_PER_EVENT",
  "events": {
    "address-fetched": {
      "title": "Address fetched",
      "description": "One BaseScan address page scraped.",
      "priceUsd": 0.05
    }
  }
}
```

- [ ] **Step 3: Replace `actors/basescan-deep/.actor/input_schema.json`**

```json
{
  "$schema": "https://apify.com/schemas/v1/input.ide.json",
  "title": "RugSleuth basescan-deep",
  "type": "object",
  "schemaVersion": 1,
  "properties": {
    "address": {
      "title": "Contract or wallet address",
      "type": "string",
      "description": "Base address (0x-prefixed, 40 hex chars).",
      "editor": "textfield",
      "pattern": "^0x[a-fA-F0-9]{40}$",
      "prefill": "0xc1fcc4300305a415a7ea894f71a0694e9f7831d3"
    }
  },
  "required": ["address"]
}
```

### Task 11: Emit the PPE event on a successful scrape

**Files:**
- Modify: `actors/basescan-deep/src/main.ts`
- Modify: `actors/basescan-deep/src/routes.ts`

- [ ] **Step 1: Replace `actors/basescan-deep/src/main.ts`**

```ts
import { PlaywrightCrawler } from '@crawlee/playwright';
import { Actor } from 'apify';
import { router } from './routes.js';

interface Input {
  address: string;
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

await Actor.init();

const input = (await Actor.getInput<Input>()) ?? ({} as Input);
const address = input.address?.trim();

if (!address || !ADDRESS_RE.test(address)) {
  await Actor.fail('Invalid address: expected 0x-prefixed 40 hex characters.');
}

const url = `https://basescan.org/address/${address}`;

const proxyConfiguration = await Actor.createProxyConfiguration({ checkAccess: false });

const crawler = new PlaywrightCrawler({
  proxyConfiguration,
  maxRequestsPerCrawl: 1,
  requestHandler: router,
  launchContext: {
    launchOptions: {
      args: ['--disable-gpu'],
    },
  },
});

await crawler.run([{ url, userData: { address } }]);

await Actor.exit();
```

- [ ] **Step 2: Replace `actors/basescan-deep/src/routes.ts`**

```ts
import { Actor } from 'apify';
import { createPlaywrightRouter } from '@crawlee/playwright';

export const router = createPlaywrightRouter();

router.addDefaultHandler(async ({ request, page, log, pushData }) => {
  const address = (request.userData as { address?: string }).address ?? '';
  log.info(`Scraping BaseScan address page`, { url: request.loadedUrl, address });

  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  const title = await page.title();

  let ethBalance: string | null = null;
  try {
    const card = page.locator('div.card').filter({ hasText: 'ETH Balance' }).first();
    if (await card.isVisible()) {
      ethBalance = (await card.innerText()).trim();
    }
  } catch (err) {
    log.warning(`Could not extract ETH balance: ${String(err)}`);
  }

  const isContract =
    (await page.locator('a[href*="#code"]:has-text("Contract")').count()) > 0;

  const verified =
    (await page
      .locator('span:has-text("Contract Source Code Verified")')
      .count()) > 0;

  const txRowsRaw: string[] = [];
  try {
    const rows = page.locator('table.table tbody tr');
    const count = Math.min(await rows.count(), 5);
    for (let i = 0; i < count; i += 1) {
      txRowsRaw.push((await rows.nth(i).innerText()).trim());
    }
  } catch (err) {
    log.warning(`Could not extract transactions: ${String(err)}`);
  }

  const item = {
    address,
    url: request.loadedUrl,
    title,
    ethBalance,
    isContract,
    verified,
    latestTxs: txRowsRaw,
    scrapedAt: new Date().toISOString(),
  };

  await pushData(item);
  // Emit the PPE billing event exactly once per successful scrape.
  await Actor.charge({ eventName: 'address-fetched' });
});
```

### Task 12: Local smoke test of the Actor

- [ ] **Step 1: Install dependencies and run locally**

```bash
npm --workspace actors/basescan-deep install
cd actors/basescan-deep
echo '{"address":"0xc1fcc4300305a415a7ea894f71a0694e9f7831d3"}' > storage/key_value_stores/default/INPUT.json
npm run start:dev
```

Expected: Run completes; `storage/datasets/default/000000001.json` contains an item with `address`, `ethBalance`, `isContract`, `verified`, `latestTxs`. Logs show `Charging event "address-fetched"` (or similar charge log line).

> If the BaseScan layout has shifted and `ethBalance` is null, that's acceptable for the MVP — the Actor still emits the event and pushes the item. Selector hardening is Phase 2 work.

- [ ] **Step 2: Return to repo root and commit**

```bash
cd ../..
git add actors/basescan-deep
git commit -m "feat(basescan-deep): PPE 'address-fetched' pricing, scrape rug-relevant fields"
```

---

## Phase 3 — `rugcheck-mcp` MCP server (TDD where useful)

### Task 13: Package skeleton

**Files:**
- Create: `services/rugcheck-mcp/package.json`
- Create: `services/rugcheck-mcp/tsconfig.json`
- Create: `services/rugcheck-mcp/vitest.config.ts`

- [ ] **Step 1: `services/rugcheck-mcp/package.json`**

```json
{
  "name": "@rugsleuth/rugcheck-mcp",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "bin": { "rugcheck-mcp": "dist/index.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@rugsleuth/x402-client": "*",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "tsx": "^4.20.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.0.0"
  }
}
```

- [ ] **Step 2: `services/rugcheck-mcp/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: `services/rugcheck-mcp/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
```

- [ ] **Step 4: Install**

```bash
npm install --workspace services/rugcheck-mcp
```

### Task 14: Stderr event logging contract

**Files:**
- Create: `services/rugcheck-mcp/src/events.ts`

- [ ] **Step 1: Define a tiny structured-log helper that the orchestrator will parse**

```ts
// services/rugcheck-mcp/src/events.ts

// Every line on stderr that begins with `RSEVT ` is a JSON event consumed by
// the orchestrator. stdout is reserved for the MCP protocol.
const PREFIX = 'RSEVT ';

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
  process.stderr.write(`${PREFIX}${JSON.stringify(event)}\n`);
}

export const EVENT_PREFIX = PREFIX;
```

### Task 15: Test — `scrape_basescan_address` tool returns a structured summary (TDD)

**Files:**
- Create: `services/rugcheck-mcp/test/scrape-basescan-address.test.ts`
- Create: `services/rugcheck-mcp/src/tools/scrape-basescan-address.ts`

- [ ] **Step 1: Write the failing test (uses an injected fake client)**

```ts
// services/rugcheck-mcp/test/scrape-basescan-address.test.ts
import { describe, expect, it, vi } from 'vitest';
import { scrapeBasescanAddress } from '../src/tools/scrape-basescan-address.js';

describe('scrape_basescan_address', () => {
  it('returns a compact summary and forwards x402 payments', async () => {
    const fakeClient = {
      on: vi.fn(),
      fetch: vi.fn().mockResolvedValue({
        result: {
          data: {
            items: [
              {
                address: '0xc1fcc4300305a415a7ea894f71a0694e9f7831d3',
                ethBalance: '0.01 ETH',
                isContract: true,
                verified: false,
                latestTxs: ['tx1', 'tx2'],
                scrapedAt: '2026-05-08T12:00:00Z',
              },
            ],
          },
        },
        payments: [
          {
            id: 'p1',
            status: 'settled' as const,
            amountUsdc: '0.05',
            payTo: '0xbee',
            ppeEvent: 'address-fetched',
            ts: '2026-05-08T12:00:00Z',
          },
        ],
      }),
    };

    const out = await scrapeBasescanAddress({
      address: '0xc1fcc4300305a415a7ea894f71a0694e9f7831d3',
      client: fakeClient as never,
      apifyBaseUrl: 'https://api.apify.com',
      actorId: 'team/basescan-deep',
    });

    expect(out.address).toBe('0xc1fcc4300305a415a7ea894f71a0694e9f7831d3');
    expect(out.isContract).toBe(true);
    expect(out.verified).toBe(false);
    expect(out.payments.length).toBe(1);
    expect(fakeClient.fetch).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
npm --workspace services/rugcheck-mcp run test
```

Expected: **FAIL** — module not found.

- [ ] **Step 3: Implement the tool**

Create `services/rugcheck-mcp/src/tools/scrape-basescan-address.ts`:

```ts
import type { X402Client, X402Response, PaymentEvent } from '@rugsleuth/x402-client';
import { emit } from '../events.js';

export interface ScrapeBasescanAddressInput {
  address: string;
  client: X402Client;
  apifyBaseUrl: string;
  actorId: string;
}

export interface ScrapeBasescanAddressOutput {
  address: string;
  ethBalance: string | null;
  isContract: boolean;
  verified: boolean;
  latestTxs: string[];
  scrapedAt: string;
  payments: PaymentEvent[];
}

interface ApifyRunResponse {
  data: {
    items: Array<{
      address: string;
      ethBalance: string | null;
      isContract: boolean;
      verified: boolean;
      latestTxs: string[];
      scrapedAt: string;
    }>;
  };
}

export async function scrapeBasescanAddress(
  input: ScrapeBasescanAddressInput,
): Promise<ScrapeBasescanAddressOutput> {
  const { address, client, apifyBaseUrl, actorId } = input;
  const tool = 'scrape_basescan_address';
  const start = Date.now();
  emit({ kind: 'tool.start', tool, args: { address } });

  const url = `${apifyBaseUrl}/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items`;

  try {
    const res = (await client.fetch({
      url,
      method: 'POST',
      body: { address },
    })) as X402Response<ApifyRunResponse>;

    for (const p of res.payments) {
      emit({
        kind: 'payment',
        tool,
        status: p.status,
        amountUsdc: p.amountUsdc,
        payTo: p.payTo,
        ppeEvent: p.ppeEvent,
        error: p.error,
      });
    }

    const item = res.result.data.items[0];
    if (!item) throw new Error('Actor returned no dataset items');

    const out: ScrapeBasescanAddressOutput = {
      address: item.address,
      ethBalance: item.ethBalance,
      isContract: item.isContract,
      verified: item.verified,
      latestTxs: item.latestTxs,
      scrapedAt: item.scrapedAt,
      payments: res.payments,
    };

    emit({ kind: 'tool.end', tool, ok: true, ms: Date.now() - start });
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ kind: 'tool.end', tool, ok: false, error: message, ms: Date.now() - start });
    throw err;
  }
}
```

- [ ] **Step 4: Run, expect pass**

```bash
npm --workspace services/rugcheck-mcp run test
```

Expected: **PASS**.

### Task 16: MCP server entry that registers the tool

**Files:**
- Create: `services/rugcheck-mcp/src/index.ts`

- [ ] **Step 1: Bootstrap an MCP server on stdio that exposes `scrape_basescan_address`**

```ts
#!/usr/bin/env node
// services/rugcheck-mcp/src/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createX402Client } from '@rugsleuth/x402-client';
import { scrapeBasescanAddress } from './tools/scrape-basescan-address.js';

const env = z
  .object({
    WALLET_PRIVATE_KEY: z
      .string()
      .regex(/^0x[a-fA-F0-9]{64}$/, 'WALLET_PRIVATE_KEY must be a 0x-prefixed 64-hex-char string'),
    APIFY_BASE_URL: z.string().url().default('https://api.apify.com'),
    BASESCAN_DEEP_ACTOR_ID: z.string().min(1),
  })
  .parse(process.env);

const client = createX402Client({ privateKey: env.WALLET_PRIVATE_KEY as `0x${string}` });

const server = new Server(
  { name: 'rugcheck-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

const SCRAPE_INPUT = {
  type: 'object',
  properties: {
    address: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
  },
  required: ['address'],
} as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'scrape_basescan_address',
      description:
        'Fetches BaseScan data for a Base contract or wallet address (balance, contract status, recent txs). Costs USDC via x402.',
      inputSchema: SCRAPE_INPUT,
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'scrape_basescan_address') {
    throw new Error(`Unknown tool: ${req.params.name}`);
  }
  const args = z
    .object({ address: z.string().regex(/^0x[a-fA-F0-9]{40}$/) })
    .parse(req.params.arguments);

  const result = await scrapeBasescanAddress({
    address: args.address,
    client,
    apifyBaseUrl: env.APIFY_BASE_URL,
    actorId: env.BASESCAN_DEEP_ACTOR_ID,
  });

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 2: Build and verify boot**

```bash
npm --workspace services/rugcheck-mcp run build
WALLET_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  BASESCAN_DEEP_ACTOR_ID=team/basescan-deep \
  node services/rugcheck-mcp/dist/index.js < /dev/null
```

Expected: process boots without throwing (it will exit immediately because `/dev/null` closes stdin — that's fine for a smoke test).

- [ ] **Step 3: Commit**

```bash
git add services/rugcheck-mcp package.json package-lock.json
git commit -m "feat(rugcheck-mcp): MCP server with scrape_basescan_address tool"
```

---

## Phase 4 — `orchestrator` (TDD)

### Task 17: Package skeleton

**Files:**
- Create: `services/orchestrator/package.json`
- Create: `services/orchestrator/tsconfig.json`
- Create: `services/orchestrator/vitest.config.ts`

- [ ] **Step 1: `services/orchestrator/package.json`**

```json
{
  "name": "@rugsleuth/orchestrator",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "fastify": "^4.28.0",
    "@fastify/cors": "^9.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "tsx": "^4.20.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.0.0"
  }
}
```

- [ ] **Step 2: `services/orchestrator/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: `services/orchestrator/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
```

- [ ] **Step 4: Install**

```bash
npm install --workspace services/orchestrator
```

### Task 18: Address validation (TDD)

**Files:**
- Create: `services/orchestrator/test/validation.test.ts`
- Create: `services/orchestrator/src/validation.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/orchestrator/test/validation.test.ts
import { describe, expect, it } from 'vitest';
import { parseAddress } from '../src/validation.js';

describe('parseAddress', () => {
  it('accepts a 0x-prefixed 40-hex address', () => {
    const a = '0xc1fcc4300305a415a7ea894f71a0694e9f7831d3';
    expect(parseAddress(a)).toBe(a);
  });

  it('lowercases mixed-case input', () => {
    const a = '0xC1FCC4300305A415A7Ea894F71a0694E9F7831D3';
    expect(parseAddress(a)).toBe(a.toLowerCase());
  });

  it('rejects bad input', () => {
    expect(() => parseAddress('0x123')).toThrow();
    expect(() => parseAddress('not-an-address')).toThrow();
    expect(() => parseAddress('')).toThrow();
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
npm --workspace services/orchestrator run test
```

- [ ] **Step 3: Implement**

```ts
// services/orchestrator/src/validation.ts
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function parseAddress(input: string): string {
  if (!ADDRESS_RE.test(input)) {
    throw new Error(`Invalid address: expected 0x + 40 hex characters, got "${input}"`);
  }
  return input.toLowerCase();
}
```

- [ ] **Step 4: Run, expect pass**

```bash
npm --workspace services/orchestrator run test
```

### Task 19: Investigation event bus

**Files:**
- Create: `services/orchestrator/src/events.ts`

- [ ] **Step 1: A simple per-investigation pub/sub**

```ts
// services/orchestrator/src/events.ts
export type InvestigationEvent =
  | { type: 'codex.line'; line: string; ts: string }
  | {
      type: 'mcp.event';
      ts: string;
      payload:
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
    }
  | { type: 'budget.exceeded'; spentUsdc: string; ts: string }
  | { type: 'investigation.completed'; reason: 'verdict' | 'timeout' | 'budget' | 'error'; ts: string };

type Listener = (event: InvestigationEvent) => void;

export class EventBus {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly history = new Map<string, InvestigationEvent[]>();

  publish(id: string, event: InvestigationEvent): void {
    const history = this.history.get(id) ?? [];
    history.push(event);
    this.history.set(id, history);
    for (const l of this.listeners.get(id) ?? []) l(event);
  }

  subscribe(id: string, listener: Listener): () => void {
    const set = this.listeners.get(id) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(id, set);
    for (const past of this.history.get(id) ?? []) listener(past);
    return () => {
      set.delete(listener);
    };
  }
}
```

### Task 20: Codex child-process driver (TDD with a fake binary)

**Files:**
- Create: `services/orchestrator/src/codex.ts`
- Create: `services/orchestrator/test/codex.test.ts`

- [ ] **Step 1: Write the failing test using a small bash fake binary**

```ts
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
```

- [ ] **Step 2: Run, expect failure**

```bash
npm --workspace services/orchestrator run test
```

- [ ] **Step 3: Implement**

```ts
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
      if (kind === 'stderr' && trimmed.startsWith(RSEVT)) {
        try {
          const payload = JSON.parse(trimmed.slice(RSEVT.length));
          opts.bus.publish(opts.investigationId, { type: 'mcp.event', ts, payload });
          continue;
        } catch {
          // fall through and treat as a regular line
        }
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
```

- [ ] **Step 4: Run, expect pass**

```bash
npm --workspace services/orchestrator run test
```

### Task 21: Investigation registry + budget enforcement (TDD)

**Files:**
- Create: `services/orchestrator/src/investigations.ts`
- Create: `services/orchestrator/test/investigations.test.ts`

- [ ] **Step 1: Write the failing test for budget enforcement**

```ts
// services/orchestrator/test/investigations.test.ts
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
```

- [ ] **Step 2: Run, expect failure**

```bash
npm --workspace services/orchestrator run test
```

- [ ] **Step 3: Implement**

```ts
// services/orchestrator/src/investigations.ts
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
```

- [ ] **Step 4: Run, expect pass**

```bash
npm --workspace services/orchestrator run test
```

### Task 22: HTTP server (Fastify) + SSE endpoint

**Files:**
- Create: `services/orchestrator/src/server.ts`
- Create: `services/orchestrator/src/index.ts`

- [ ] **Step 1: `services/orchestrator/src/server.ts`**

```ts
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
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (event: InvestigationEvent): void => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const unsub = opts.bus.subscribe(req.params.id, send);
    req.raw.on('close', unsub);
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
```

- [ ] **Step 2: `services/orchestrator/src/index.ts`**

```ts
import { z } from 'zod';
import { EventBus } from './events.js';
import { Investigations } from './investigations.js';
import { spawnCodex } from './codex.js';
import { buildServer, spawnFactory } from './server.js';

const env = z
  .object({
    ORCHESTRATOR_PORT: z.coerce.number().default(4000),
    INVESTIGATION_BUDGET_USDC: z.coerce.number().default(2.0),
    INVESTIGATION_TIMEOUT_MS: z.coerce.number().default(180_000),
    CODEX_BIN: z.string().default('codex'),
    BASESCAN_DEEP_ACTOR_ID: z.string(),
    WALLET_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    APIFY_BASE_URL: z.string().url().default('https://api.apify.com'),
    OPENAI_API_KEY: z.string(),
  })
  .parse(process.env);

const SYSTEM_PROMPT = [
  'You are RugSleuth, an autonomous onchain investigator.',
  'Use the rugcheck-mcp tools to gather evidence about a Base contract address.',
  'Prefer cheap signals first. Stop investigating as soon as you can issue a confident verdict.',
  'When done, print a final JSON line on stdout: {"verdict": {...}}.',
].join(' ');

const bus = new EventBus();

const spawn = spawnFactory({
  command: env.CODEX_BIN,
  args: ({ address }) => [
    '--mcp-server',
    'rugsleuth=npx --workspace services/rugcheck-mcp rugcheck-mcp',
    '--system',
    SYSTEM_PROMPT,
    '--input',
    `Investigate ${address} on Base. Budget: ${env.INVESTIGATION_BUDGET_USDC} USDC.`,
  ],
  env: {
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    WALLET_PRIVATE_KEY: env.WALLET_PRIVATE_KEY,
    APIFY_BASE_URL: env.APIFY_BASE_URL,
    BASESCAN_DEEP_ACTOR_ID: env.BASESCAN_DEEP_ACTOR_ID,
  },
  bus,
  spawnCodex,
});

const investigations = new Investigations(bus, {
  spawn,
  budgetUsdc: env.INVESTIGATION_BUDGET_USDC,
  timeoutMs: env.INVESTIGATION_TIMEOUT_MS,
});

const app = buildServer({ bus, investigations });
await app.listen({ port: env.ORCHESTRATOR_PORT, host: '0.0.0.0' });
```

> **Note:** The exact Codex CLI flags above (`--mcp-server`, `--system`, `--input`) may differ on your installed Codex version. Verify with `codex --help` and adjust the `args(...)` factory accordingly. The MCP server name (`rugsleuth=...`) is the key Codex uses to address tools.

- [ ] **Step 3: Build**

```bash
npm --workspace services/orchestrator run build
```

- [ ] **Step 4: Commit**

```bash
git add services/orchestrator package.json package-lock.json
git commit -m "feat(orchestrator): fastify SSE, investigation registry, budget cap, codex spawner"
```

---

## Phase 5 — `dashboard` (Next.js, minimal)

### Task 23: Next.js skeleton

**Files:**
- Create: `apps/dashboard/package.json`
- Create: `apps/dashboard/next.config.ts`
- Create: `apps/dashboard/tsconfig.json`
- Create: `apps/dashboard/tailwind.config.ts`
- Create: `apps/dashboard/postcss.config.mjs`
- Create: `apps/dashboard/app/layout.tsx`
- Create: `apps/dashboard/app/globals.css`

- [ ] **Step 1: `apps/dashboard/package.json`**

```json
{
  "name": "@rugsleuth/dashboard",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: `apps/dashboard/next.config.ts`**

```ts
import type { NextConfig } from 'next';
const nextConfig: NextConfig = { reactStrictMode: true };
export default nextConfig;
```

- [ ] **Step 3: `apps/dashboard/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: `apps/dashboard/tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
export default config;
```

- [ ] **Step 5: `apps/dashboard/postcss.config.mjs`**

```js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

- [ ] **Step 6: `apps/dashboard/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body { background: #0b0b0d; color: #e7e7ea; }
```

- [ ] **Step 7: `apps/dashboard/app/layout.tsx`**

```tsx
import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'RugSleuth',
  description: 'Autonomous onchain investigator. Pays for its own intel via x402.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-mono">{children}</body>
    </html>
  );
}
```

- [ ] **Step 8: Install**

```bash
npm install --workspace apps/dashboard
```

### Task 24: SSE consumer hook

**Files:**
- Create: `apps/dashboard/lib/useInvestigation.ts`

- [ ] **Step 1: A simple hook that POSTs an investigation, then opens an EventSource**

```tsx
// apps/dashboard/lib/useInvestigation.ts
'use client';
import { useCallback, useRef, useState } from 'react';

export type DashboardEvent =
  | { type: 'codex.line'; line: string; ts: string }
  | {
      type: 'mcp.event';
      ts: string;
      payload:
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
    }
  | { type: 'budget.exceeded'; spentUsdc: string; ts: string }
  | {
      type: 'investigation.completed';
      reason: 'verdict' | 'timeout' | 'budget' | 'error';
      ts: string;
    };

const ORCHESTRATOR =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:4000';

export function useInvestigation() {
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  const start = useCallback(async (address: string) => {
    setEvents([]);
    setError(null);
    setStatus('running');
    try {
      const res = await fetch(`${ORCHESTRATOR}/investigations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { id } = (await res.json()) as { id: string };

      sourceRef.current?.close();
      const source = new EventSource(`${ORCHESTRATOR}/investigations/${id}/events`);
      sourceRef.current = source;
      source.onmessage = (e) => {
        const event = JSON.parse(e.data) as DashboardEvent;
        setEvents((prev) => [...prev, event]);
        if (event.type === 'investigation.completed') {
          setStatus('done');
          source.close();
        }
      };
      source.onerror = () => {
        setStatus('error');
        setError('SSE connection lost');
        source.close();
      };
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  return { start, events, status, error };
}
```

### Task 25: UI components

**Files:**
- Create: `apps/dashboard/components/AddressInput.tsx`
- Create: `apps/dashboard/components/EventFeed.tsx`
- Create: `apps/dashboard/components/VerdictCard.tsx`
- Create: `apps/dashboard/app/page.tsx`

- [ ] **Step 1: `apps/dashboard/components/AddressInput.tsx`**

```tsx
'use client';
import { useState } from 'react';

export function AddressInput({ onSubmit, disabled }: {
  onSubmit: (address: string) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState('');
  const valid = /^0x[a-fA-F0-9]{40}$/.test(value);

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(value.toLowerCase());
      }}
    >
      <input
        className="flex-1 bg-black border border-zinc-700 px-3 py-2 rounded font-mono text-sm"
        placeholder="0x… (Base contract or wallet)"
        value={value}
        onChange={(e) => setValue(e.target.value.trim())}
        disabled={disabled}
      />
      <button
        className="px-4 py-2 rounded bg-emerald-500 text-black font-semibold disabled:opacity-30"
        disabled={!valid || disabled}
        type="submit"
      >
        Investigate
      </button>
    </form>
  );
}
```

- [ ] **Step 2: `apps/dashboard/components/EventFeed.tsx`**

```tsx
'use client';
import type { DashboardEvent } from '../lib/useInvestigation';

export function EventFeed({ events }: { events: DashboardEvent[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Pane title="Codex transcript">
        {events
          .filter((e) => e.type === 'codex.line')
          .map((e, i) => (
            <div key={i} className="text-xs text-zinc-300 whitespace-pre-wrap leading-snug">
              {(e as Extract<DashboardEvent, { type: 'codex.line' }>).line}
            </div>
          ))}
      </Pane>
      <Pane title="x402 payments">
        {events.flatMap((e, i) => {
          if (e.type !== 'mcp.event' || e.payload.kind !== 'payment') return [];
          const p = e.payload;
          const colour = {
            required: 'text-amber-400',
            signed: 'text-sky-400',
            settled: 'text-emerald-400',
            failed: 'text-rose-400',
          }[p.status];
          return [
            <div key={i} className={`text-xs ${colour}`}>
              {p.status.padEnd(8)} {p.amountUsdc} USDC → {p.tool}
              {p.ppeEvent ? ` · ${p.ppeEvent}` : ''}
              {p.error ? ` · ${p.error}` : ''}
            </div>,
          ];
        })}
      </Pane>
    </div>
  );
}

function Pane({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-zinc-800 rounded p-3">
      <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">{title}</div>
      <div className="space-y-1 max-h-[60vh] overflow-y-auto">{children}</div>
    </div>
  );
}
```

- [ ] **Step 3: `apps/dashboard/components/VerdictCard.tsx`**

```tsx
'use client';
import type { DashboardEvent } from '../lib/useInvestigation';

export function VerdictCard({ events }: { events: DashboardEvent[] }) {
  const completed = events.find((e) => e.type === 'investigation.completed') as
    | Extract<DashboardEvent, { type: 'investigation.completed' }>
    | undefined;
  if (!completed) return null;

  const reason = completed.reason;
  const settledPayments = events.filter(
    (e): e is Extract<DashboardEvent, { type: 'mcp.event' }> =>
      e.type === 'mcp.event' && e.payload.kind === 'payment' && e.payload.status === 'settled',
  );
  const total = settledPayments.reduce(
    (sum, e) => sum + Number.parseFloat((e.payload as { amountUsdc: string }).amountUsdc),
    0,
  );

  return (
    <div className="border border-emerald-700 rounded p-4 mt-4">
      <div className="text-sm text-emerald-400">
        Investigation complete · reason: {reason}
      </div>
      <div className="text-xs text-zinc-400 mt-1">
        Settled payments: {settledPayments.length} · Total spent: ${total.toFixed(4)} USDC
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `apps/dashboard/app/page.tsx`**

```tsx
'use client';
import { AddressInput } from '../components/AddressInput';
import { EventFeed } from '../components/EventFeed';
import { VerdictCard } from '../components/VerdictCard';
import { useInvestigation } from '../lib/useInvestigation';

export default function Page() {
  const { start, events, status, error } = useInvestigation();
  return (
    <main className="max-w-5xl mx-auto p-6 space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">RugSleuth</h1>
        <span className="text-xs text-zinc-500">{status}</span>
      </header>
      <AddressInput onSubmit={start} disabled={status === 'running'} />
      {error && <div className="text-rose-400 text-sm">{error}</div>}
      <EventFeed events={events} />
      <VerdictCard events={events} />
    </main>
  );
}
```

- [ ] **Step 5: Build**

```bash
npm --workspace apps/dashboard run build
```

Expected: clean build (or only the standard Next.js telemetry warning).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard package.json package-lock.json
git commit -m "feat(dashboard): minimal SSE-driven UI for RugSleuth investigations"
```

---

## Phase 6 — End-to-end wiring

### Task 26: Local end-to-end smoke test (mock Apify)

This task verifies the full pipe **without** spending real USDC. We point the orchestrator at our mock x402 server and a fake Codex.

**Files:**
- Create: `scripts/e2e-mock.sh`

- [ ] **Step 1: Create `scripts/e2e-mock.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Boot the orchestrator with a fake codex that calls scrape_basescan_address
# once via the rugcheck-mcp server, with a mock x402 server in the loop.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 1. Start a mock x402 server in the background (uses the test fixture).
node -e '
import("./packages/x402-client/test/mock-server.ts").then(async (mod) => {
  const m = await mod.startMockServer({});
  console.log(JSON.stringify({ url: m.url }));
  process.stdin.resume();
});' > /tmp/rs-mock.log &
MOCK_PID=$!
sleep 1
MOCK_URL="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("/tmp/rs-mock.log","utf8")).url)')"

# 2. Build everything.
npm --workspace packages/x402-client run build
npm --workspace services/rugcheck-mcp run build
npm --workspace services/orchestrator run build

# 3. Start orchestrator with a fake codex.
CODEX_BIN="$(node -e 'console.log(require.resolve("./scripts/fake-codex.mjs"))')" \
WALLET_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
APIFY_BASE_URL="$MOCK_URL" \
BASESCAN_DEEP_ACTOR_ID=team/basescan-deep \
OPENAI_API_KEY=sk-test \
ORCHESTRATOR_PORT=4000 \
node services/orchestrator/dist/index.js &
ORCH_PID=$!

cleanup() { kill "$ORCH_PID" "$MOCK_PID" 2>/dev/null || true; }
trap cleanup EXIT
sleep 1

# 4. Drive an investigation and stream events.
ID="$(curl -s -X POST http://localhost:4000/investigations \
  -H 'content-type: application/json' \
  -d '{"address":"0xc1fcc4300305a415a7ea894f71a0694e9f7831d3"}' | jq -r .id)"
echo "Investigation: $ID"
curl -N "http://localhost:4000/investigations/$ID/events"
```

- [ ] **Step 2: Create `scripts/fake-codex.mjs`**

```js
#!/usr/bin/env node
// Pretends to be Codex: connects to rugcheck-mcp via stdio, calls one tool,
// then exits. Used by the mock e2e test.
import { spawn } from 'node:child_process';

console.log('plan: scrape_basescan_address');
const mcp = spawn('node', ['services/rugcheck-mcp/dist/index.js'], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let id = 0;
function send(msg) {
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: ++id, ...msg }) + '\n');
}

mcp.stdout.on('data', (c) => process.stdout.write(c)); // surface MCP responses

setTimeout(() => {
  send({
    method: 'tools/call',
    params: {
      name: 'scrape_basescan_address',
      arguments: { address: '0xc1fcc4300305a415a7ea894f71a0694e9f7831d3' },
    },
  });
}, 200);

setTimeout(() => {
  console.log('verdict: done');
  mcp.kill();
  process.exit(0);
}, 5_000);
```

> The fake-codex script intentionally bypasses Codex's CLI flag handling — it talks JSON-RPC directly to the MCP server. This decouples the e2e smoke test from any specific Codex version.

- [ ] **Step 3: Run the mock e2e**

```bash
chmod +x scripts/e2e-mock.sh scripts/fake-codex.mjs
./scripts/e2e-mock.sh
```

Expected: SSE stream prints `codex.line` events ("plan: scrape_basescan_address", "verdict: done"), one or more `mcp.event` payment events with `status: settled`, and finally an `investigation.completed` event.

- [ ] **Step 4: Commit**

```bash
git add scripts
git commit -m "chore: add mock end-to-end smoke script"
```

### Task 27: Real x402 dry run against published `basescan-deep`

This step requires the `basescan-deep` Actor to be **published** on Apify with PPE pricing enabled, and a wallet funded with at least $1 USDC on Base.

- [ ] **Step 1: Publish the Actor**

```bash
cd actors/basescan-deep
apify login        # interactive — runs once
apify push
```

Note the published Actor ID in the form `username/basescan-deep`.

- [ ] **Step 2: Confirm PPE pricing in the Apify Console**

In the browser, open the Actor's settings page and verify `address-fetched` appears with price `$0.05`. Adjust if needed.

- [ ] **Step 3: Run the orchestrator pointed at real Apify with the real Codex**

```bash
cd ../..
cp .env.example .env.local
# Edit .env.local to set:
#   WALLET_PRIVATE_KEY=...
#   OPENAI_API_KEY=...
#   BASESCAN_DEEP_ACTOR_ID=<your-username>/basescan-deep
#   APIFY_BASE_URL=https://api.apify.com

set -a; source .env.local; set +a

npm --workspace packages/x402-client run build
npm --workspace services/rugcheck-mcp run build
npm --workspace services/orchestrator run build

node services/orchestrator/dist/index.js &
ORCH_PID=$!
trap "kill $ORCH_PID" EXIT
sleep 2
npm --workspace apps/dashboard run dev
```

- [ ] **Step 4: Drive the investigation from the dashboard**

Open `http://localhost:3000`. Paste a valid Base address (start with the prefilled one from the Actor: `0xc1fcc4300305a415a7ea894f71a0694e9f7831d3`). Click **Investigate**.

Expected:
- The right pane shows `required → signed → settled` for one payment of `0.05 USDC` to the `address-fetched` event.
- The left pane shows the Codex transcript ("plan: ...", tool calls, final verdict line).
- The verdict card appears with `reason: verdict` (or `timeout` if Codex stalls — that's still a valid demo of the budget/timeout safety).
- The agent's wallet shows ≈ $0.05 less USDC on a Base block explorer (settlement is on-chain only on the very first call per session).

- [ ] **Step 5: Tag the milestone**

```bash
git tag -a v0.1.0-mvp -m "RugSleuth MVP: end-to-end x402 payment + Codex investigator + dashboard"
```

---

## Self-review notes

- **Spec coverage:** All Phase-1 PRD requirements (FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7 partial — only `scrape_basescan_address` and a hand-driven verdict are wired; FR-8, FR-9 implicit via Codex behaviour and budget cap; FR-10–FR-13 covered by `x402-client`; FR-14 partial — verdict card surfaces completion + spend but not the full `Verdict` shape, deferred). NFR-1 (env vars), NFR-2 (cap responsibility on the operator funding the wallet — noted in `.env.example`), NFR-3 (orchestrator), NFR-4 (Fastify logger captures all HTTP), NFR-5 (orchestrator captures stdout/stderr through the bus), NFR-6 (tsc + ESLint follow-up — Prettier is not yet configured at the workspace root; defer to Phase 2), NFR-7 (each library/service has at least one unit test).
- **Placeholders:** none of the forbidden phrases ("TODO", "TBD", "implement later") appear in any task body. Every code step contains the actual code. Two **verification notes** appear (challenge format, Codex flags); these are explicit risks for the operator to confirm against external docs, not placeholders for missing work.
- **Type consistency:** `PaymentEvent.status` is `'required' | 'signed' | 'settled' | 'failed'` everywhere (types.ts, mock server, MCP `events.ts`, orchestrator events, dashboard hook). Tool name `scrape_basescan_address` is identical across MCP server registration, fake codex driver, and dashboard event filters. Event prefix `RSEVT ` matches in `services/rugcheck-mcp/src/events.ts` and `services/orchestrator/src/codex.ts`.
- **Scope:** This plan is one buildable vertical slice. Multi-tool integration (Twitter, Dexscreener, deployer/holders endpoints, full verdict heuristic) is intentionally a separate Phase-2 plan.
