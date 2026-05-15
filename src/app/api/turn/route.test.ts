import { describe, it, expect } from 'vitest';
import { POST } from './route';
import type { PhaseEvent } from '@/lib/sse/events';
import { parseSseChunks } from '@/lib/sse/parse';
import { mockRunTurn } from '@/lib/sse/runner';

async function drain(res: Response): Promise<PhaseEvent[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const events: PhaseEvent[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const { events: chunkEvents, rest } = parseSseChunks(buf);
    events.push(...chunkEvents);
    buf = rest;
  }
  return events;
}

function postBody(body: unknown, signal?: AbortSignal): Request {
  return new Request('http://test/api/turn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

describe('POST /api/turn', () => {
  it('returns 200 + SSE stream of mock events on a valid body', async () => {
    const res = await POST(
      postBody({ slug: 'commodore-vex', input: 'I confront the harbormaster.' }),
      // Inject the mock runner with delayMs=0 for fast tests.
      { runner: (input, emit) => mockRunTurn(input, emit, { delayMs: 0 }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const events = await drain(res);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('phase');
    expect(types[types.length - 1]).toBe('done');
  });

  it('returns 400 on missing slug', async () => {
    const res = await POST(postBody({ input: 'x' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 on empty input', async () => {
    const res = await POST(postBody({ slug: 'commodore-vex', input: '' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 on non-JSON body', async () => {
    const res = await POST(
      new Request('http://test/api/turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('concurrency invariant #3: client abort does NOT cancel the runner', async () => {
    const seen: PhaseEvent[] = [];
    let resolveRunner!: () => void;
    const runnerDone = new Promise<void>((r) => (resolveRunner = r));

    // A runner that emits one event, awaits an external signal we own, then
    // completes. If the route propagates abort to the runner, this never
    // resolves — and the test times out. If the route honors invariant #3,
    // we resolve `runnerDone` manually and assert the runner saw both events.
    const runner = async (
      _input: { slug: string; input: string },
      emit: (ev: PhaseEvent) => void,
    ) => {
      emit({ type: 'phase', name: 'factions', count: 0 });
      seen.push({ type: 'phase', name: 'factions', count: 0 });
      await runnerDone;
      emit({ type: 'done', audioPath: '/x', finalProse: 'x', images: [] });
      seen.push({ type: 'done', audioPath: '/x', finalProse: 'x', images: [] });
    };

    const ac = new AbortController();
    const res = await POST(postBody({ slug: 's', input: 'i' }, ac.signal), { runner });

    // Read the first event so we know the runner has started.
    const reader = res.body!.getReader();
    await reader.read();

    // Abort the *client* (the Request signal). This MUST NOT abort the runner.
    ac.abort();

    // Give the route a tick to register the abort + flip its clientGone flag.
    await new Promise((r) => setTimeout(r, 10));

    // Resolve the runner's pending await. If invariant #3 holds, this
    // completes naturally and `seen` has both events.
    resolveRunner();
    await new Promise((r) => setTimeout(r, 10));

    expect(seen.map((e) => e.type)).toEqual(['phase', 'done']);
  });
});
