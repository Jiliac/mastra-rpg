import { describe, it, expect, vi } from 'vitest';
import { handleTurnPost as POST } from './route';
import type { PhaseEvent } from '@/lib/sse/events';
import { parseSseChunks } from '@/lib/sse/parse';
import { mockRunTurn, mockRunAsk } from '@/lib/sse/runner';

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
      // Inject the mock runner with delayMs=0 for fast tests. The classify
      // override avoids hitting a real LLM in unit tests.
      {
        classify: async () => ({ isOoc: false, reasoning: 'test' }),
        runner: (input, emit) => mockRunTurn(input, emit, { delayMs: 0 }),
      },
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

  it('forks to OOC runner when the classifier returns isOoc=true', async () => {
    const res = await POST(postBody({ slug: 'commodore-vex', input: 'where are we?' }), {
      classify: async () => ({ isOoc: true, reasoning: 'meta question' }),
      askRunner: (input, emit) => mockRunAsk(input, emit, { delayMs: 0 }),
    });
    expect(res.status).toBe(200);
    const events = await drain(res);
    // First non-heartbeat event is the OOC ask phase, not a factions phase.
    const first = events[0] as Extract<PhaseEvent, { type: 'phase' }>;
    expect(first.type).toBe('phase');
    expect(first.name).toBe('ask');
    const done = events[events.length - 1] as Extract<PhaseEvent, { type: 'done' }>;
    expect(done.type).toBe('done');
    expect(done.audioPath).toBeNull();
    expect(done.mode).toBe('ooc');
    expect(done.images).toEqual([]);
  });

  it('runs canonical pipeline when classifier returns isOoc=false', async () => {
    const seenRunner = vi.fn(
      async (
        input: { slug: string; input: string },
        emit: (ev: PhaseEvent) => void,
      ): Promise<void> => {
        await mockRunTurn(input, emit, { delayMs: 0 });
      },
    );
    const askSpy = vi.fn(async () => {});

    const res = await POST(postBody({ slug: 'commodore-vex', input: 'I draw my blaster.' }), {
      classify: async () => ({ isOoc: false, reasoning: 'in-fiction action' }),
      runner: seenRunner,
      askRunner: askSpy,
    });
    expect(res.status).toBe(200);
    const events = await drain(res);
    expect(seenRunner).toHaveBeenCalledOnce();
    expect(askSpy).not.toHaveBeenCalled();
    // The first event from the canonical mock is `phase: factions`, not ask.
    const first = events[0] as Extract<PhaseEvent, { type: 'phase' }>;
    expect(first.name).toBe('factions');
  });

  it('falls back to canonical when the classifier hangs past the timeout', async () => {
    const seenRunner = vi.fn(
      async (
        input: { slug: string; input: string },
        emit: (ev: PhaseEvent) => void,
      ): Promise<void> => {
        await mockRunTurn(input, emit, { delayMs: 0 });
      },
    );
    const askSpy = vi.fn(async () => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Classifier never resolves; the route must time it out and proceed.
    const res = await POST(postBody({ slug: 'commodore-vex', input: 'meta?' }), {
      classify: () => new Promise<never>(() => {}),
      classifyTimeoutMs: 25,
      runner: seenRunner,
      askRunner: askSpy,
    });
    expect(res.status).toBe(200);
    await drain(res);
    expect(seenRunner).toHaveBeenCalledOnce();
    expect(askSpy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    const firstWarn = warn.mock.calls[0]?.join(' ') ?? '';
    expect(firstWarn).toMatch(/classifier timed out/);
    warn.mockRestore();
  });

  it('falls back to canonical when the classifier throws', async () => {
    const seenRunner = vi.fn(
      async (
        input: { slug: string; input: string },
        emit: (ev: PhaseEvent) => void,
      ): Promise<void> => {
        await mockRunTurn(input, emit, { delayMs: 0 });
      },
    );
    const askSpy = vi.fn(async () => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await POST(postBody({ slug: 'commodore-vex', input: 'hmm' }), {
      classify: async () => {
        throw new Error('classifier offline');
      },
      runner: seenRunner,
      askRunner: askSpy,
    });
    expect(res.status).toBe(200);
    await drain(res);
    expect(seenRunner).toHaveBeenCalledOnce();
    expect(askSpy).not.toHaveBeenCalled();
    warn.mockRestore();
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
    const res = await POST(postBody({ slug: 's', input: 'i' }, ac.signal), {
      classify: async () => ({ isOoc: false, reasoning: 'test' }),
      runner,
    });

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
