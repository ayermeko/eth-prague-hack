// services/rugcheck-mcp/src/blacklists/scam-sniffer.ts

export const SCAMSNIFFER_URL =
  'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface ScamSnifferOptions {
  fetch?: typeof globalThis.fetch;
  ttlMs?: number;
  url?: string;
}

export type ScamSnifferChecker = (address: string) => Promise<boolean>;

export function createScamSnifferChecker(opts: ScamSnifferOptions = {}): ScamSnifferChecker {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  const url = opts.url ?? process.env.SCAMSNIFFER_URL ?? SCAMSNIFFER_URL;

  let set: Set<string> = new Set();
  let loadedAt = 0;
  let inflight: Promise<void> | null = null;

  async function refresh(): Promise<void> {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) return;
      const data = (await res.json()) as unknown;
      if (!Array.isArray(data)) return;
      set = new Set(
        data.filter((s): s is string => typeof s === 'string').map((s) => s.toLowerCase()),
      );
      loadedAt = Date.now();
    } catch {
      // fail-soft
    }
  }

  return async (address: string): Promise<boolean> => {
    if (Date.now() - loadedAt >= ttl) {
      inflight ??= refresh().finally(() => {
        inflight = null;
      });
      await inflight;
    }
    return set.has(address.toLowerCase());
  };
}
