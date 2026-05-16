import { describe, it, expect } from 'vitest';
import { parseSseChunks } from './parse';
import { serializeEvent } from './serialize';
import type { PhaseEvent } from './events';

describe('parseSseChunks', () => {
  it('returns empty on empty buffer', () => {
    expect(parseSseChunks('')).toEqual({ events: [], rest: '' });
  });

  it('parses a single complete record', () => {
    const ev: PhaseEvent = { type: 'phase', name: 'factions', count: 2 };
    const { events, rest } = parseSseChunks(serializeEvent(ev));
    expect(events).toEqual([ev]);
    expect(rest).toBe('');
  });

  it('parses multiple back-to-back records', () => {
    const a: PhaseEvent = { type: 'phase', name: 'narrator' };
    const b: PhaseEvent = { type: 'prose_delta', text: 'hello ' };
    const c: PhaseEvent = { type: 'prose_delta', text: 'world' };
    const buf = serializeEvent(a) + serializeEvent(b) + serializeEvent(c);
    expect(parseSseChunks(buf).events).toEqual([a, b, c]);
  });

  it('returns a partial trailing record as rest', () => {
    const a: PhaseEvent = { type: 'phase', name: 'media' };
    const partial = `event: prose_delta\ndata: {"type":"prose`; // no \n\n
    const buf = serializeEvent(a) + partial;
    const { events, rest } = parseSseChunks(buf);
    expect(events).toEqual([a]);
    expect(rest).toBe(partial);
  });

  it('drops a record with malformed JSON', () => {
    const buf = `event: phase\ndata: {not json}\n\n`;
    expect(parseSseChunks(buf)).toEqual({ events: [], rest: '' });
  });

  it('drops a record whose data is well-formed JSON but not a PhaseEvent', () => {
    const buf = `event: phase\ndata: {"type":"unknown"}\n\n`;
    expect(parseSseChunks(buf)).toEqual({ events: [], rest: '' });
  });

  it('ignores comment records (heartbeats)', () => {
    const a: PhaseEvent = { type: 'phase', name: 'persist' };
    const buf = `: heartbeat\n\n` + serializeEvent(a) + `: heartbeat\n\n`;
    expect(parseSseChunks(buf).events).toEqual([a]);
  });
});
