import { describe, it, expect } from 'vitest';
import type { PhaseEvent } from './events';
import { initialState, reducePhaseEvent, type UiState } from './reducer';

const step = (state: UiState, ...events: PhaseEvent[]): UiState =>
  events.reduce((s, e) => reducePhaseEvent(s, e), state);

describe('reducePhaseEvent', () => {
  it('starts idle', () => {
    const s = initialState();
    expect(s.status).toBe('idle');
    expect(s.phases).toEqual([]);
    expect(s.prose).toBe('');
  });

  it('factions phase appends the first record and goes streaming', () => {
    const s = step(initialState(), { type: 'phase', name: 'factions', count: 2 });
    expect(s.status).toBe('streaming');
    expect(s.phases).toEqual([{ name: 'factions', status: 'active', count: 2 }]);
  });

  it('factions phase with count=0 (player-alone path) preserves the zero', () => {
    // Wave 5 explicitly emits { type: 'phase', name: 'factions', count: 0 }
    // when no NPC factions are present. The reducer must preserve the
    // zero count rather than dropping or defaulting it, so the phase tape
    // can render the "you act alone" state distinctly.
    const s = step(initialState(), { type: 'phase', name: 'factions', count: 0 });
    expect(s.status).toBe('streaming');
    expect(s.phases).toEqual([{ name: 'factions', status: 'active', count: 0 }]);
  });

  it('subsequent phase marks previous done and appends new active', () => {
    const s = step(
      initialState(),
      { type: 'phase', name: 'factions', count: 2 },
      { type: 'phase', name: 'narrator' },
    );
    expect(s.phases.map((p) => p.status)).toEqual(['done', 'active']);
  });

  it('prose_delta concatenates', () => {
    const s = step(
      initialState(),
      { type: 'phase', name: 'narrator' },
      { type: 'prose_delta', text: 'It ' },
      { type: 'prose_delta', text: 'begins.' },
    );
    expect(s.prose).toBe('It begins.');
  });

  it('done captures final payload', () => {
    const s = step(
      initialState(),
      { type: 'phase', name: 'persist' },
      {
        type: 'done',
        audioPath: '/abs/audio/narrator-turn-001.ogg',
        finalProse: 'Final.',
        images: [{ filename: 'a.png', path: '/abs/images/a.png', prompt: 'p', slug: 's' }],
      },
    );
    expect(s.status).toBe('done');
    expect(s.finalProse).toBe('Final.');
    expect(s.audioPath).toBe('/abs/audio/narrator-turn-001.ogg');
    expect(s.images).toHaveLength(1);
    expect(s.phases[s.phases.length - 1].status).toBe('done');
  });

  it('recoverable error captures message and flips status', () => {
    const s = step(initialState(), {
      type: 'error',
      message: 'still working',
      recoverable: true,
    });
    expect(s.status).toBe('error');
    expect(s.error).toEqual({ message: 'still working', recoverable: true });
  });

  it('non-recoverable error captures recoverable=false', () => {
    const s = step(initialState(), {
      type: 'error',
      message: 'vault write failed: ENOSPC',
      recoverable: false,
    });
    expect(s.error?.recoverable).toBe(false);
  });
});
