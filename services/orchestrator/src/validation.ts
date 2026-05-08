// services/orchestrator/src/validation.ts
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function parseAddress(input: string): string {
  if (!ADDRESS_RE.test(input)) {
    throw new Error(`Invalid address: expected 0x + 40 hex characters, got "${input}"`);
  }
  return input.toLowerCase();
}
