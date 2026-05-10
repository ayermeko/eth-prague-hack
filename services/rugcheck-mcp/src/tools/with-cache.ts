// services/rugcheck-mcp/src/tools/with-cache.ts
import { emit } from '../events.js';
import type { WalletCache } from '../wallet-cache.js';

export interface CachedToolInput {
  address: string;
}

export interface WithCacheOptions<O> {
  tool: string;
  ttlMs: number;
  cache: WalletCache;
  /**
   * Optional predicate: return false to skip storing this result.
   * Defaults to "cache everything". Use to avoid caching soft-fail empty
   * results that would poison subsequent calls for the full TTL.
   */
  shouldCache?: (result: O) => boolean;
}

export function withCache<I extends CachedToolInput, O>(
  fn: (input: I) => Promise<O>,
  opts: WithCacheOptions<O>,
): (input: I) => Promise<O> {
  return async (input: I): Promise<O> => {
    const cached = opts.cache.get<O>(input.address, opts.tool);
    if (cached !== null) {
      emit({ kind: 'tool.start', tool: opts.tool, args: { address: input.address } });
      emit({ kind: 'tool.end', tool: opts.tool, ok: true, ms: 0, cached: true });
      return cached;
    }
    const result = await fn(input);
    if (!opts.shouldCache || opts.shouldCache(result)) {
      opts.cache.set(input.address, opts.tool, result, opts.ttlMs);
    }
    return result;
  };
}
