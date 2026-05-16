import { describe, it, expect } from 'vitest';
import type { PhaseEvent } from './events';
import { mockRunTurn } from './runner';

describe('mockRunTurn', () => {
  it('emits the canonical happy-path sequence', async () => {
    const emitted: PhaseEvent[] = [];
    await mockRunTurn(
      { slug: 'commodore-vex', input: 'I confront the harbormaster.' },
      (ev) => emitted.push(ev),
      { delayMs: 0 }, // disable timers in tests
    );

    const types = emitted.map((e) => `${e.type}:${'name' in e ? e.name : ''}`);
    expect(types).toEqual([
      'phase:factions',
      'phase:narrator',
      'prose_delta:',
      'prose_delta:',
      'prose_delta:',
      'phase:media',
      'phase:persist',
      'done:',
    ]);
    // factions count is non-negative integer
    const factions = emitted[0] as Extract<PhaseEvent, { type: 'phase'; name: 'factions' }>;
    expect(typeof factions.count).toBe('number');
    expect(factions.count).toBeGreaterThanOrEqual(0);
    // done payload has the right shape
    const done = emitted[emitted.length - 1] as Extract<PhaseEvent, { type: 'done' }>;
    expect(typeof done.audioPath).toBe('string');
    expect(typeof done.finalProse).toBe('string');
    expect(Array.isArray(done.images)).toBe(true);
  });

  it('respects MOCK_FAIL=mutex (emits the spec mutex-contention error)', async () => {
    const emitted: PhaseEvent[] = [];
    await mockRunTurn(
      { slug: 'commodore-vex', input: 'second concurrent turn' },
      (ev) => emitted.push(ev),
      { delayMs: 0, failure: 'mutex' },
    );
    expect(emitted).toEqual([{ type: 'error', message: 'still working', recoverable: true }]);
  });

  it('runner does not accept an AbortSignal (compile-time contract)', () => {
    // This is a type-level assertion: mockRunTurn's third param is MockOpts,
    // which has no `signal` field. If a future edit adds one, the
    // `@ts-expect-error` below will go cold and the build will fail.
    const opts: Parameters<typeof mockRunTurn>[2] = {
      // @ts-expect-error — MockOpts has no `signal` field by design
      signal: new AbortController().signal,
    };
    void opts;
    expect(true).toBe(true);
  });
});
