// services/rugcheck-mcp/src/blacklists/goplus.ts

export type GoPlusSeverity = 'low' | 'medium' | 'high';

export interface GoPlusFlag {
  flag: string;
  severity: GoPlusSeverity;
}

export type GoPlusResult =
  | { ok: true; flags: GoPlusFlag[] }
  | { ok: false; error: string };

const SEVERITY: Record<string, GoPlusSeverity> = {
  cybercrime: 'high',
  sanctioned: 'high',
  phishing_activities: 'high',
  financial_crime: 'high',
  mixer: 'medium',
  blackmail_activities: 'medium',
  honeypot_related_address: 'medium',
  stealing_attack: 'medium',
  fake_kyc: 'low',
  malicious_mining_activities: 'low',
};

export interface FetchGoPlusOptions {
  address: string;
  chainId: number;
  fetch?: typeof globalThis.fetch;
}

export async function fetchGoPlusFlags(opts: FetchGoPlusOptions): Promise<GoPlusResult> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const url = `https://api.gopluslabs.io/api/v1/address_security/${opts.address}?chain_id=${opts.chainId}`;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return { ok: false, error: `goplus ${res.status}` };
    const body = (await res.json()) as { result?: Record<string, string> };
    const result = body.result ?? {};
    const flags: GoPlusFlag[] = [];
    for (const [k, v] of Object.entries(result)) {
      if (v === '1' && SEVERITY[k]) {
        flags.push({ flag: k, severity: SEVERITY[k] });
      }
    }
    return { ok: true, flags };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
