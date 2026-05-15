import { describe, it, expect } from 'vitest';
import type { PhaseEvent } from './events';
import { serializeEvent, serializeHeartbeat } from './serialize';
import { parseSseChunks } from './parse';

describe('serializeEvent', () => {
  it('round-trips phase factions', () => {
    const ev: PhaseEvent = { type: 'phase', name: 'factions', count: 3 };
    const wire = serializeEvent(ev);
    expect(wire).toBe(`event: phase\ndata: {"type":"phase","name":"factions","count":3}\n\n`);
    const { events } = parseSseChunks(wire);
    expect(events).toEqual([ev]);
  });

  it('round-trips phase narrator (no count)', () => {
    const ev: PhaseEvent = { type: 'phase', name: 'narrator' };
    const wire = serializeEvent(ev);
    expect(wire).toBe(`event: phase\ndata: {"type":"phase","name":"narrator"}\n\n`);
    expect(parseSseChunks(wire).events).toEqual([ev]);
  });

  it('round-trips prose_delta with escaped chars', () => {
    const ev: PhaseEvent = { type: 'prose_delta', text: 'line1\nline2\twith "quotes"' };
    const wire = serializeEvent(ev);
    expect(wire.endsWith('\n\n')).toBe(true);
    expect(parseSseChunks(wire).events).toEqual([ev]);
  });

  it('round-trips done', () => {
    const ev: PhaseEvent = {
      type: 'done',
      audioPath: '/abs/audio/narrator-turn-001.ogg',
      finalProse: 'Final prose with ![[a.png]].',
      images: [
        {
          filename: 'a.png',
          path: '/abs/images/a.png',
          prompt: 'A scene.',
          slug: 'kessha',
        },
      ],
    };
    const wire = serializeEvent(ev);
    expect(parseSseChunks(wire).events).toEqual([ev]);
  });

  it('round-trips error', () => {
    const ev: PhaseEvent = { type: 'error', message: 'still working', recoverable: true };
    expect(parseSseChunks(serializeEvent(ev)).events).toEqual([ev]);
  });
});

describe('serializeHeartbeat', () => {
  it('returns a comment record', () => {
    expect(serializeHeartbeat()).toBe(': heartbeat\n\n');
  });
});
