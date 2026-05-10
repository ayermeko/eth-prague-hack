// services/orchestrator/test/codex.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { spawnCodex, tryParseVerdict } from '../src/codex.js';
import { EventBus, InvestigationEvent } from '../src/events.js';

describe('spawnCodex', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

  it('streams stdout as codex.line and stderr RSEVT lines as mcp.event', async () => {
    const bus = new EventBus();
    const collected: InvestigationEvent[] = [];
    const unsub = bus.subscribe('inv-1', (e) => collected.push(e));
    cleanups.push(unsub);

    const fakeBinary =
      'echo plan; echo "RSEVT {\\"kind\\":\\"tool.start\\",\\"tool\\":\\"x\\",\\"args\\":{}}" 1>&2; echo done';
    const proc = await spawnCodex({
      investigationId: 'inv-1',
      bus,
      command: 'sh',
      args: ['-c', fakeBinary],
      env: {},
    });

    const exit = await proc.exit;
    expect(exit).toBe(0);

    expect(collected.some((e) => e.type === 'codex.line' && e.line === 'plan')).toBe(true);
    expect(
      collected.some(
        (e) => e.type === 'mcp.event' && e.payload.kind === 'tool.start' && e.payload.tool === 'x',
      ),
    ).toBe(true);
  });

  it('emits verdict.rendered when stdout contains a VERDICT: JSON line', async () => {
    const bus = new EventBus();
    const collected: InvestigationEvent[] = [];
    const unsub = bus.subscribe('inv-2', (e) => collected.push(e));
    cleanups.push(unsub);

    const verdictJson =
      '{"score":78,"label":"SUSPICIOUS","confidence":"medium","reasons":["foo"],"evidence":[{"source":"BaseScan","finding":"unverified","costUsdc":"0.05"}],"durationSec":4}';
    const proc = await spawnCodex({
      investigationId: 'inv-2',
      bus,
      command: 'sh',
      args: ['-c', `echo 'VERDICT: ${verdictJson}'`],
      env: {},
    });

    await proc.exit;

    const verdictEvent = collected.find(
      (e): e is Extract<InvestigationEvent, { type: 'verdict.rendered' }> =>
        e.type === 'verdict.rendered',
    );
    expect(verdictEvent).toBeDefined();
    expect(verdictEvent?.verdict.score).toBe(78);
    expect(verdictEvent?.verdict.label).toBe('SUSPICIOUS');
    expect(verdictEvent?.verdict.evidence[0]?.source).toBe('BaseScan');
    // Raw line is also surfaced for the EventFeed.
    expect(
      collected.some((e) => e.type === 'codex.line' && e.line.startsWith('VERDICT:')),
    ).toBe(true);
  });
});

describe('tryParseVerdict', () => {
  it('returns null for non-VERDICT lines', () => {
    expect(tryParseVerdict('plan: do stuff')).toBeNull();
    expect(tryParseVerdict('verdict: lowercase prefix is rejected')).toBeNull();
  });

  it('returns null for malformed JSON after the prefix', () => {
    expect(tryParseVerdict('VERDICT: {not-json')).toBeNull();
  });

  it('clamps score and defaults missing/invalid fields', () => {
    const result = tryParseVerdict('VERDICT: {"score":250,"label":"NOPE"}');
    expect(result).toEqual({
      score: 100,
      label: 'INCONCLUSIVE',
      confidence: 'low',
      reasons: [],
      evidence: [],
      durationSec: 0,
    });
  });

  it('passes through a well-formed verdict', () => {
    const result = tryParseVerdict(
      'VERDICT: {"score":42,"label":"INCONCLUSIVE","confidence":"high","reasons":["a"],"evidence":[{"source":"x","finding":"y","costUsdc":"0.10"}],"durationSec":7}',
    );
    expect(result).toEqual({
      score: 42,
      label: 'INCONCLUSIVE',
      confidence: 'high',
      reasons: ['a'],
      evidence: [{ source: 'x', finding: 'y', costUsdc: '0.10' }],
      durationSec: 7,
    });
  });
});
