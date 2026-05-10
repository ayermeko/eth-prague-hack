export interface BuildCodexExecArgsInput {
  address: string;
  budgetUsdc: number;
  systemPrompt: string;
}

export function buildCodexExecArgs(input: BuildCodexExecArgsInput): string[] {
  return [
    'exec',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--ephemeral',
    `${input.systemPrompt}

Investigate ${input.address} on Base. Budget: ${input.budgetUsdc} USDC.`,
  ];
}
