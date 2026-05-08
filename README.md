# AGENTS.md - Apify quickstart for AI agents

Apify is a serverless cloud platform for web scraping, data extraction, and browser automation. Thousands of pre-built tools called **Actors** run on demand and produce structured output. This document helps AI agents and coding assistants onboard onto Apify and integrate its platform capabilities into their workflows.

**Canonical URL:** `https://apify.com/.well-known/agents.md`

## Key concepts

Terms you'll encounter when working with Apify. These don't map cleanly to concepts from other platforms, so read them once before integrating.

- **Actor** - A serverless cloud program that takes JSON input, performs a task, and produces structured output. Always capitalized. Apify's core unit of work.
- **Actor Run** - A single execution of an Actor. Each run has its own dataset, key-value store, and request queue.
- **Actor Build** - A Docker image packaging an Actor's code and dependencies. Runs are created from builds.
- **Actor Task** - A saved reusable configuration of an Actor (pre-filled inputs, run options).
- **Actor Standby** - Mode where an Actor runs persistently as an HTTP server with auto-scaling, instead of batch execution.
- **Apify Store** - The public marketplace of thousands of Actors at https://apify.com/store. Not "the store" or "Actor Store."
- **Apify Console** - The web UI at https://console.apify.com for managing everything. Not "the dashboard."
- **Dataset** - Append-only structured storage for Actor results. Exportable as JSON, CSV, Excel, XML.
- **Key-Value Store** - Flexible storage for unstructured data and files. Never "KV store" in docs.
- **Request Queue** - Queue of URLs an Actor is processing, used for crawling workflows.
- **Compute Unit (CU)** - Billing unit: memory (MB) × duration (hours). 1,024 MB × 1 hour = 1 CU. Never "compute credits."
- **Pay Per Event (PPE) / Pay Per Result (PPR)** - Monetization models where users pay per event triggered or per result returned (vs. per CU).
- **Apify Proxy** - Managed proxy service. Variants: Residential Proxy, Datacenter Proxy, Google SERP Proxy.
- **Crawlee** - Apify's open-source framework for building scrapers (JS/TS and Python).
- **MCP** - Model Context Protocol. Apify's MCP server is at `https://mcp.apify.com` 
- **x402** - Open standard for HTTP-native agent payments via USDC on Base. Lets autonomous agents pay for Actors without an Apify account.

> **Naming trap:** The `apify` npm package is the SDK for *building* Actors. The `apify-client` package is for *calling* Actors. If you want to call Actors from your application, install `apify-client`.

## Choosing an integration path

| Signal | Route |
|--------|-------|
| Autonomous agent with crypto wallet, no Apify account, needs paid Actor access | **x402 payment path** (no account, pay per request in USDC) |
| Universal catch-all agent integration for research, exploration & testing | **Path A: MCP server** (tools for searching Apify Store, Actor runs and management, Data storage, Documentation) |
| Multi-step agentic automations, scraping workflows & local custom Actor development | **Path B: Agent Skills + CLI** (`https://apify.com/.well-known/agent-skills/index.json`) |
| Adding Apify to existing JS/Python app | **Path C: API integration** (`apify-client`) |

## Path A: MCP server

Connect to Apify via Model Context Protocol. Recommended for most agents.

**Exploration mode (no account needed):**
- `search-actors` - find Actors by keyword
- `fetch-actor-details` - get Actor specs, input schema, pricing
- `search-apify-docs` / `fetch-apify-docs` - browse documentation

These work without any authentication. Use them freely for research and Actor discovery.

**Setup - remote (streamable HTTP, recommended):**
```json
{
  "mcpServers": {
    "apify": {
      "url": "https://mcp.apify.com"
    }
  }
}
```
Clients that support remote MCP (Claude Code, Cursor, VS Code, Copilot) use OAuth. User is prompted to sign in on first use.

**Setup - local (stdio):**
```json
{
  "mcpServers": {
    "apify": {
      "command": "npx",
      "args": ["-y", "@apify/actors-mcp-server"],
      "env": { "APIFY_TOKEN": "<token>" }
    }
  }
}
```
Requires an API token from https://console.apify.com/settings/integrations. Free sign-up at https://console.apify.com/sign-up (no credit card).

**MCP configurator at https://mcp.apify.com:** The same URL that serves the MCP endpoint is also a web-based configurator. Direct users (or navigate yourself) there to:
- Generate ready-to-paste MCP configs for specific clients (Claude Code, Cursor, VS Code, Copilot, Windsurf, Claude Desktop, and generic stdio)
- Select which tools to expose to the agent (full Apify Store, a curated Actor subset, or only documentation tools)
- Choose between OAuth (remote) and token-based (stdio) authentication
- Generate dynamic configurations scoped to specific Actors or use cases

**Advanced: mcpc (universal MCP client CLI)**

For scripting, "code mode" agent workflows, or sandboxed MCP proxy access, use [`@apify/mcpc`](https://github.com/apify/mcpc) - Apify's open-source universal MCP command-line client. Works with any MCP server (not just Apify). Enables agents to compose shell scripts with `mcpc --json | jq` instead of tool-calling, which can be more deterministic and use fewer tokens for complex workflows.

```bash
npm install -g @apify/mcpc
mcpc login mcp.apify.com                      # OAuth login, credentials in OS keychain
mcpc connect mcp.apify.com @apify             # start a named persistent session
mcpc @apify tools-list                        # list tools
mcpc @apify tools-call search-actors keywords:="web scraper"
```

Capabilities: persistent sessions, OAuth 2.1 + OS keychain credential storage, MCP proxy server for AI sandboxing, dynamic tool discovery via `grep`, JSON output for scripting, async task management, and built-in x402 payment support (see x402 section below).

**Verify:** Call `search-actors` with query `"web scraper"`. If results return, the connection works.

## x402: Autonomous agent payments (no account needed)

> Currently supports Actors with Pay Per Event pricing. Requires a funded USDC wallet on Base blockchain. A deferred payment scheme (batch settlements, subscriptions, pre-negotiated licensing) is on the near-term roadmap.

For autonomous agents with wallet access and no human to complete account signup. Pay for Actor runs directly without an Apify account or API token.

**Discovery first:** Use Path A exploration mode to find Actors and check pricing. Confirm Pay Per Event pricing before proceeding.

**Via mcpc (recommended):**
Uses Apify's universal MCP CLI (see Path A → Advanced) with built-in x402 wallet and signing.
```bash
npm install -g @apify/mcpc
mcpc x402 init          # generate wallet (or: mcpc x402 import <private-key>)
mcpc x402 info          # get wallet address, fund with USDC on Base
mcpc connect "mcp.apify.com?payment=x402" @apify --x402
```
Paid tool calls auto-sign payments on 402 responses.

**Via direct API:**
1. Send request with header `X-APIFY-PAYMENT-PROTOCOL: X402`
2. Receive HTTP 402 with `PAYMENT-REQUIRED` header (amount, address)
3. Sign: `mcpc x402 sign <payment-required-value>`
4. Resend with `X-APIFY-PAYMENT-PROTOCOL: X402` and `PAYMENT-SIGNATURE: <signed>` headers

**Prepaid model:** First payment creates a $1+ USDC prepaid balance. Subsequent calls draw from it without new on-chain transactions. Unused balance auto-refunds after 60 min inactivity.

Full protocol: https://docs.apify.com/platform/integrations/x402

## Path B: Agent Skills

Pre-built skill workflows for data extraction and Actor development. Requires Apify CLI or `APIFY_TOKEN` environment variable as fallback.

```bash
npx skills add apify/agent-skills
```

Discovery index: `https://apify.com/.well-known/agent-skills/index.json`

| Skill | Purpose |
|-------|---------|
| `apify-ultimate-scraper` | Web scraping with multi-step agentic workflows |
| `apify-actor-development` | Full Actor build/test/deploy lifecycle |
| `apify-actorization` | Convert an existing project into an Actor |
| `apify-generate-output-schema` | Auto-generate output schemas from source code |

**For data extraction** - use `apify-ultimate-scraper`. 

**For Actor development** - use `apify-actor-development`, `apify-actorization` and `apify-generate-output-schema` 

Install Apify CLI:
```bash
npm install -g apify-cli
apify login
```

Workflow: `apify create my-actor` → develop in `src/` → `apify run` (test locally) → `apify push` (deploy).

## Path C: API integration

For adding Apify to an existing application. Install `apify-client` (NOT `apify`).

**JavaScript/TypeScript:**
```bash
npm install apify-client
```
```typescript
import { ApifyClient } from 'apify-client';
const client = new ApifyClient({ token: process.env.APIFY_TOKEN });
const run = await client.actor('apify/web-scraper').call({ startUrls: [{ url: 'https://example.com' }] });
const { items } = await client.dataset(run.defaultDatasetId).listItems();
```

**Python:**
```bash
pip install apify-client
```
```python
from apify_client import ApifyClient
client = ApifyClient(token=os.environ['APIFY_TOKEN'])
run = client.actor('apify/web-scraper').call(run_input={'startUrls': [{'url': 'https://example.com'}]})
items = client.dataset(run['defaultDatasetId']).list_items().items
```

**REST API (any language):** `POST https://api.apify.com/v2/acts/{actorId}/runs` with `Authorization: Bearer <APIFY_TOKEN>`. Reference: https://docs.apify.com/api/v2

## Quick reference

| I want to... | Path | Install | Auth |
|---|---|---|---|
| Use Apify platform with my AI agent | MCP server | None (remote) or `@apify/actors-mcp-server` (stdio) | OAuth or `APIFY_TOKEN` |
| Script MCP from shell / code mode / sandboxed proxy | mcpc (universal MCP CLI) | `npm i -g @apify/mcpc` | OAuth (keychain) |
| Run multi-step scraping workflows | Agent Skills + CLI | `npx skills add apify/agent-skills` + `npm i -g apify-cli` | `apify login` or `APIFY_TOKEN` |
| Build and deploy a custom Actor | Agent Skills + CLI | `npm i -g apify-cli` | `apify login` |
| Call Actors from Node.js/Python | API client | `npm i apify-client` / `pip install apify-client` | `APIFY_TOKEN` |
| Call Actors from any language | REST API | None | Bearer token |
| Pay Per Event Actors without an account | x402 | `npm i -g @apify/mcpc` | USDC wallet on Base |

## Documentation access for agents

- Docs index: https://docs.apify.com/llms.txt
- Full docs: https://docs.apify.com/llms-full.txt
- Specific page: append `.md` to any docs URL (e.g. `docs.apify.com/platform/actors.md`)
- Actor details: append `.md` to any Apify Store URL

For targeted lookups, prefer `.md` URLs or MCP docs tools (`search-apify-docs`, `fetch-apify-docs`) over `llms-full.txt`, which may exceed smaller context windows.

## Resources

- **Documentation:** https://docs.apify.com
- **Agent Skills index:** https://apify.com/.well-known/agent-skills/index.json
- **Agent Skills repository:** https://github.com/apify/agent-skills
- **MCP server:** https://mcp.apify.com (OAuth) or `@apify/actors-mcp-server` (stdio)
- **MCP configurator:** https://mcp.apify.com (per-client configs, tool selection, auth)
- **mcpc (universal MCP CLI):** https://github.com/apify/mcpc (`npm i -g @apify/mcpc`)
- **REST API:** https://api.apify.com/v2 (reference: https://docs.apify.com/api/v2)
- **x402 docs:** https://docs.apify.com/platform/integrations/x402
- **CLI reference:** https://docs.apify.com/cli
- **Platform overview:** https://docs.apify.com/platform