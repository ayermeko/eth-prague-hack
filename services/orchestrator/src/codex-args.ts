export interface BuildCodexExecArgsInput {
  address: string;
  budgetUsdc: number;
  systemPrompt: string;
}

export function buildCodexExecArgs(input: BuildCodexExecArgsInput): string[] {
  return [
    'exec',
    '--skip-git-repo-check',
    '--dangerously-bypass-approvals-and-sandbox',
    `${input.systemPrompt}

Investigate ${input.address} on Base. Budget: ${input.budgetUsdc} USDC.`,
  ];
}
