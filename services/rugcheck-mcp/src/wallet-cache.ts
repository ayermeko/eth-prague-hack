// services/rugcheck-mcp/src/wallet-cache.ts

interface Entry {
  value: unknown;
  expiresAt: number;
}

export class WalletCache {
  private readonly store = new Map<string, Entry>();

  private key(wallet: string, tool: string): string {
    return `${wallet.toLowerCase()}::${tool}`;
  }

  get<T>(wallet: string, tool: string): T | null {
    const k = this.key(wallet, tool);
    const entry = this.store.get(k);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(k);
      return null;
    }
    return entry.value as T;
  }

  set(wallet: string, tool: string, value: unknown, ttlMs: number): void {
    if (ttlMs <= 0) {
      throw new Error(`WalletCache.set: ttlMs must be positive, got ${ttlMs}`);
    }
    this.store.set(this.key(wallet, tool), {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }
}
