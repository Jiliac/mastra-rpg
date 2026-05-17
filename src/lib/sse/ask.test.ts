import { describe, it, expect, vi } from 'vitest';
import * as path from 'node:path';
import type { PhaseEvent } from './events';
import type { AgentLike, AgentStreamLike } from '@/mastra/workflows/turn';
import { runAsk, mockRunAsk } from './ask';

const FIXTURE = path.resolve('tests/fixtures/test-vault');

function makeStreamAgent(chunks: string[]): AgentLike<unknown> {
  return {
    async generate() {
      throw new Error('generate should not be called for OOC streaming');
    },
    async stream(): Promise<AgentStreamLike<unknown>> {
      async function* iter() {
        for (const c of chunks) yield c;
      }
      return {
        textStream: iter(),
        object: Promise.resolve({}),
      };
    },
  };
}

function makeThrowingAgent(message: string): AgentLike<unknown> {
  return {
    async generate() {
      throw new Error(message);
    },
    async stream(): Promise<AgentStreamLike<unknown>> {
      throw new Error(message);
    },
  };
}

describe('mockRunAsk', () => {
  it('emits ask → prose_deltas → done with mode=ooc and audioPath=null', async () => {
    const seen: PhaseEvent[] = [];
    await mockRunAsk({ slug: 's', input: 'where are we?' }, (e) => seen.push(e), { delayMs: 0 });
    expect(seen[0]).toEqual({ type: 'phase', name: 'ask' });
    expect(seen[seen.length - 1]).toMatchObject({
      type: 'done',
      audioPath: null,
      images: [],
      mode: 'ooc',
    });
    const proseDeltas = seen.filter((e) => e.type === 'prose_delta');
    expect(proseDeltas.length).toBeGreaterThan(0);
  });
});

describe('runAsk (live)', () => {
  it('streams loremaster prose, emits ooc done, and persists to ooc.md', async () => {
    const chunks = ['You are in the harbor. ', 'Mira is on the pier.'];
    const seen: PhaseEvent[] = [];
    const appendSpy = vi.fn().mockResolvedValue(undefined);

    await runAsk(
      { slug: 'test-vault', input: 'where are we?' },
      {
        loremasterAgent: makeStreamAgent(chunks),
        emit: (e) => seen.push(e),
        vaultRoot: () => FIXTURE,
        appendOoc: appendSpy,
      },
    );

    expect(seen[0]).toEqual({ type: 'phase', name: 'ask' });
    const deltas = seen.filter((e) => e.type === 'prose_delta');
    expect(deltas.map((e) => (e as Extract<PhaseEvent, { type: 'prose_delta' }>).text)).toEqual(
      chunks,
    );
    const done = seen[seen.length - 1] as Extract<PhaseEvent, { type: 'done' }>;
    expect(done.type).toBe('done');
    expect(done.mode).toBe('ooc');
    expect(done.audioPath).toBeNull();
    expect(done.images).toEqual([]);
    expect(done.finalProse).toBe(chunks.join(''));

    expect(appendSpy).toHaveBeenCalledWith(FIXTURE, 'where are we?', chunks.join(''));
  });

  it('emits recoverable error when the loremaster stream throws', async () => {
    const seen: PhaseEvent[] = [];
    const appendSpy = vi.fn();

    await runAsk(
      { slug: 'test-vault', input: 'meta?' },
      {
        loremasterAgent: makeThrowingAgent('boom'),
        emit: (e) => seen.push(e),
        vaultRoot: () => FIXTURE,
        appendOoc: appendSpy,
      },
    );

    const errors = seen.filter((e) => e.type === 'error');
    expect(errors).toHaveLength(1);
    const err = errors[0] as Extract<PhaseEvent, { type: 'error' }>;
    expect(err.recoverable).toBe(true);
    expect(err.message).toContain('boom');
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it('emits non-recoverable error when the vault read fails', async () => {
    const seen: PhaseEvent[] = [];
    await runAsk(
      { slug: 'does-not-exist', input: 'meta?' },
      {
        loremasterAgent: makeStreamAgent(['x']),
        emit: (e) => seen.push(e),
        vaultRoot: () => '/tmp/rpg-no-such-vault-' + Date.now(),
        appendOoc: vi.fn(),
      },
    );
    const errors = seen.filter((e) => e.type === 'error');
    expect(errors).toHaveLength(1);
    const err = errors[0] as Extract<PhaseEvent, { type: 'error' }>;
    expect(err.recoverable).toBe(false);
    expect(err.message).toContain('vault read failed');
  });

  it('swallows appendOoc failures (player already saw the answer)', async () => {
    const seen: PhaseEvent[] = [];
    const appendSpy = vi.fn().mockRejectedValue(new Error('disk full'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await runAsk(
      { slug: 'test-vault', input: 'meta?' },
      {
        loremasterAgent: makeStreamAgent(['hello']),
        emit: (e) => seen.push(e),
        vaultRoot: () => FIXTURE,
        appendOoc: appendSpy,
      },
    );

    const done = seen.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(seen.some((e) => e.type === 'error')).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
