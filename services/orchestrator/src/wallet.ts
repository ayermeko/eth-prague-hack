import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface AgentWalletInfo {
  address: string;
  createdAt: string;
  balances: { usdc: string; eth: string };
}

export type AgentWalletErrorKind =
  | 'mcpc_missing'
  | 'no_wallet'
  | 'subprocess_failed';

export interface AgentWalletError {
  kind: AgentWalletErrorKind;
  message: string;
  hint?: string;
}

export type AgentWalletResult =
  | { ok: true; info: AgentWalletInfo }
  | { ok: false; error: AgentWalletError };

// Subprocess shape we need (signatures match the Node 20 child_process types).
export type WalletExec = (
  file: string,
  args: ReadonlyArray<string>,
  options: { timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

export interface FetchAgentWalletOptions {
  bin?: string;
  timeoutMs?: number;
  exec?: WalletExec;
}

/**
 * Shells out to `mcpc x402 --json info` and returns a typed wallet snapshot.
 * Soft-fails: every failure mode produces a structured error the caller can
 * surface to the user, never throws. Pure and easy to unit-test by passing a
 * fake `exec`.
 */
export async function fetchAgentWallet(
  opts: FetchAgentWalletOptions = {},
): Promise<AgentWalletResult> {
  const bin = opts.bin ?? 'mcpc';
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const exec = opts.exec ?? (execFileAsync as unknown as WalletExec);

  let stdout: string;
  try {
    const result = await exec(bin, ['x402', '--json', 'info'], { timeout: timeoutMs });
    stdout = result.stdout;
  } catch (err) {
    return { ok: false, error: classifyExecError(err, bin) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return {
      ok: false,
      error: {
        kind: 'subprocess_failed',
        message: `${bin} x402 --json info returned non-JSON output`,
      },
    };
  }

  const info = pickAgentWalletInfo(parsed);
  if (!info) {
    return {
      ok: false,
      error: {
        kind: 'subprocess_failed',
        message: `${bin} x402 info JSON missing required fields`,
      },
    };
  }
  return { ok: true, info };
}

function classifyExecError(err: unknown, bin: string): AgentWalletError {
  const e = err as { code?: string; stderr?: string; message?: string };
  if (e?.code === 'ENOENT') {
    return {
      kind: 'mcpc_missing',
      message: `${bin} not found on PATH`,
      hint: `install with: npm install -g @apify/mcpc`,
    };
  }
  const stderr = (e?.stderr ?? '').toLowerCase();
  if (
    stderr.includes('no wallet') ||
    stderr.includes('not initialized') ||
    stderr.includes('does not exist')
  ) {
    return {
      kind: 'no_wallet',
      message: `${bin} has no x402 wallet configured`,
      hint: `run: ${bin} x402 init  (or: ${bin} x402 import <private-key>)`,
    };
  }
  return {
    kind: 'subprocess_failed',
    message: e?.message ?? String(err),
  };
}

function pickAgentWalletInfo(value: unknown): AgentWalletInfo | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const balances =
    v.balances && typeof v.balances === 'object'
      ? (v.balances as Record<string, unknown>)
      : null;
  if (!balances) return null;
  if (
    typeof v.address !== 'string' ||
    typeof balances.usdc !== 'string' ||
    typeof balances.eth !== 'string'
  ) {
    return null;
  }
  return {
    address: v.address,
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : '',
    balances: { usdc: balances.usdc, eth: balances.eth },
  };
}
