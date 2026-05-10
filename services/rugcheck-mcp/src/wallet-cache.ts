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
    const entry = this.store.get(this.key(wallet, tool));
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(this.key(wallet, tool));
      return null;
    }
    return entry.value as T;
  }

  set(wallet: string, tool: string, value: unknown, ttlMs: number): void {
    this.store.set(this.key(wallet, tool), {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }
}
