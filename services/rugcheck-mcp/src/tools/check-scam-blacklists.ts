// services/rugcheck-mcp/src/tools/check-scam-blacklists.ts
import { emit } from '../events.js';
import type { GoPlusResult } from '../blacklists/goplus.js';
import type { ScamSnifferChecker } from '../blacklists/scam-sniffer.js';

export interface CheckScamBlacklistsInput {
  address: string;
  goPlus: (opts: { address: string }) => Promise<GoPlusResult>;
  scamSnifferCheck: ScamSnifferChecker;
}

export interface BlacklistHit {
  source: 'goplus' | 'scamsniffer';
  flag: string;
  severity: 'low' | 'medium' | 'high';
}

export interface CheckScamBlacklistsOutput {
  address: string;
  hits: BlacklistHit[];
  clean: boolean;
  sources: { goplus: 'ok' | 'error'; scamsniffer: 'ok' | 'error' };
  payments: [];
}

export async function checkScamBlacklists(
  input: CheckScamBlacklistsInput,
): Promise<CheckScamBlacklistsOutput> {
  const tool = 'check_scam_blacklists';
  const start = Date.now();
  emit({ kind: 'tool.start', tool, args: { address: input.address } });

  const [goRes, snifferRes] = await Promise.all([
    input.goPlus({ address: input.address }).catch(
      (err): GoPlusResult => ({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }),
    ),
    input.scamSnifferCheck(input.address).then(
      (hit) => ({ ok: true as const, hit }),
      (err) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }),
    ),
  ]);

  const hits: BlacklistHit[] = [];
  if (goRes.ok) {
    for (const f of goRes.flags) {
      hits.push({ source: 'goplus', flag: f.flag, severity: f.severity });
    }
  }
  if (snifferRes.ok && snifferRes.hit) {
    hits.push({ source: 'scamsniffer', flag: 'listed', severity: 'high' });
  }

  const sources = {
    goplus: goRes.ok ? ('ok' as const) : ('error' as const),
    scamsniffer: snifferRes.ok ? ('ok' as const) : ('error' as const),
  };

  emit({ kind: 'tool.end', tool, ok: true, ms: Date.now() - start });

  return {
    address: input.address,
    hits,
    clean: hits.length === 0,
    sources,
    payments: [],
  };
}
