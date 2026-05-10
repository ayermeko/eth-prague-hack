import { describe, expect, it } from 'vitest';
import { buildCodexExecArgs } from '../src/codex-args.js';

describe('buildCodexExecArgs', () => {
  it('runs the investigation agent in a restricted non-persistent sandbox', () => {
    const args = buildCodexExecArgs({
      address: '0x1bd831237695a48f3fb4413faedd77482371df61',
      budgetUsdc: 2,
      systemPrompt: 'system',
    });

    expect(args).toContain('--sandbox');
    expect(args).toContain('read-only');
    expect(args).toContain('--ephemeral');
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(args.at(-1)).toContain('Investigate 0x1bd831237695a48f3fb4413faedd77482371df61');
  });
});
