// src/lib/sse/runner.ts
//
// The Wave-5/Wave-6 seam. `runTurn` produces a sequence of PhaseEvents
// to an `emit` callback. The route handler hooks `emit` to a
// ReadableStream writer.
//
// Concurrency invariant #3: there is NO AbortSignal parameter, by
// design. Client disconnect must not abort the workflow; the route
// just stops draining `emit` into its response, the workflow runs to
// completion in background.
//
// Mode selection (permanent two-mode seam):
//   - `opts.runner` (test DI) or `process.env.RPG_RUNNER_MOCK === '1'`
//     routes to `mockRunTurn` — used by tests and local UI dev to
//     avoid LLM/API costs.
//   - Otherwise `liveRunTurn` calls `runTurn` from
//     `@/mastra/workflows/turn` directly (Wave 5 is merged at f36cd02).

import type { PhaseEvent } from './events';
import {
  runTurn as workflowRunTurn,
  type RunTurnInput as WorkflowInput,
  type RunTurnDeps,
  type AgentLike,
} from '@/mastra/workflows/turn';
import { narratorAgent } from '@/mastra/agents/narrator';
import { factionAgent } from '@/mastra/agents/faction';
import { illustratorAgent } from '@/mastra/agents/illustrator';
import { loremasterAgent } from '@/mastra/agents/loremaster';
import { vaultRoot } from '@/lib/vault/paths';
import { ttsRender } from '@/lib/media/tts';
import type { NarratorOutput, FactionOutput, IllustratorOutput } from '@/lib/schemas';
import { runAsk as askRunAsk, mockRunAsk, type RunAskInput, type MockAskOpts } from './ask';

export interface RunTurnInput {
  slug: string;
  input: string;
}

export type Emit = (ev: PhaseEvent) => void;

export interface MockOpts {
  /** ms between mock events. 0 disables timers (use in tests). Default: 250. */
  delayMs?: number;
  /** Inject a deterministic failure. Default: undefined (happy path). */
  failure?: 'mutex' | 'narrator' | 'tts';
}

// ----- mock implementation ------------------------------------------------

const MOCK_DELTAS = [
  'It begins. ',
  'Kessha turns to face you, her eyes hard. ',
  'The harbor wind picks up, salt-thick and sudden.',
];

export async function mockRunTurn(
  input: RunTurnInput,
  emit: Emit,
  opts: MockOpts = {},
): Promise<void> {
  void input;
  const delay = opts.delayMs ?? 250;
  const sleep = (ms: number) =>
    ms === 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

  if (opts.failure === 'mutex') {
    emit({ type: 'error', message: 'still working', recoverable: true });
    return;
  }

  emit({ type: 'phase', name: 'factions', count: 2 });
  await sleep(delay);

  emit({ type: 'phase', name: 'narrator' });
  await sleep(delay);

  if (opts.failure === 'narrator') {
    emit({
      type: 'error',
      message: 'narrator failed; please rephrase',
      recoverable: true,
    });
    return;
  }

  for (const d of MOCK_DELTAS) {
    emit({ type: 'prose_delta', text: d });
    await sleep(delay);
  }

  emit({ type: 'phase', name: 'media' });
  await sleep(delay);

  if (opts.failure === 'tts') {
    emit({ type: 'error', message: 'audio render failed', recoverable: true });
    return;
  }

  emit({ type: 'phase', name: 'persist' });
  await sleep(delay);

  const finalProse = MOCK_DELTAS.join('');
  emit({
    type: 'done',
    audioPath: `/mock/audio/narrator-turn-mock.ogg`,
    finalProse,
    images: [],
  });
}

// ----- live implementation ------------------------------------------------

/**
 * Adapt a Mastra `Agent`-like instance to Wave-5's structural `AgentLike<T>`.
 *
 * Wave 5 expects:
 *   generate(prompt: string): Promise<{ object: T }>
 *   stream(prompt: string): Promise<{ textStream: AsyncIterable<string>; object: Promise<T> }>
 *
 * Mastra's concrete `Agent.generate(messages, options)` returns a `FullOutput<T>`
 * (which has `.object` plus many other fields) and `Agent.stream(...)` returns
 * a `MastraModelOutput<T>` whose `textStream` is a `ReadableStream<string>`
 * (which IS async-iterable at runtime in Node 22+ but its TS type doesn't
 * always declare `[Symbol.asyncIterator]`). This adapter narrows both to the
 * exact shape Wave 5 destructures.
 */
function adaptMastraAgent<T>(agent: {
  generate: (prompt: string) => Promise<{ object: T }>;
  stream: (
    prompt: string,
  ) => Promise<{ textStream: ReadableStream<string> | AsyncIterable<string>; object: Promise<T> }>;
}): AgentLike<T> {
  return {
    async generate(prompt: string) {
      const res = await agent.generate(prompt);
      return { object: res.object };
    },
    async stream(prompt: string) {
      const res = await agent.stream(prompt);
      const ts = res.textStream;
      // ReadableStream is async-iterable at runtime in Node 22+. If the
      // type system doesn't see `[Symbol.asyncIterator]`, fall back to a
      // reader-based iterator. Try the native path first.
      const asyncIter: AsyncIterable<string> =
        Symbol.asyncIterator in (ts as object)
          ? (ts as AsyncIterable<string>)
          : readableStreamToAsyncIterable(ts as ReadableStream<string>);
      return { textStream: asyncIter, object: res.object };
    },
  };
}

function readableStreamToAsyncIterable<T>(stream: ReadableStream<T>): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      const reader = stream.getReader();
      return {
        async next(): Promise<IteratorResult<T>> {
          const { done, value } = await reader.read();
          if (done) return { done: true, value: undefined };
          return { done: false, value };
        },
        async return(): Promise<IteratorResult<T>> {
          reader.releaseLock();
          return { done: true, value: undefined };
        },
      };
    },
  };
}

/**
 * Live runner. Wave 5 is MERGED (commit `f36cd02`) — this is the REAL
 * body. Mastra's concrete `Agent` class does not structurally assign to
 * `AgentLike<T>` (its `generate`/`stream` take a richer message+options
 * shape and return `FullOutput<T>`/`MastraModelOutput<T>`), so each agent
 * is wrapped through `adaptMastraAgent` before being handed to `RunTurnDeps`.
 */
export async function liveRunTurn(input: RunTurnInput, emit: Emit): Promise<void> {
  const workflowInput: WorkflowInput = {
    vaultRoot: vaultRoot(input.slug),
    playerInput: input.input,
  };

  // The cast on each agent is a structural assertion: we promise the
  // adapter that the runtime Agent's `generate(prompt)` and
  // `stream(prompt)` short-form (no options arg) resolves to objects
  // with the right shape. Mastra's `Agent.generate<OUTPUT>(messages)`
  // overload at agent.d.ts:844 returns `Promise<FullOutput<OUTPUT>>`,
  // which exposes `.object` (output.d.ts:58); `Agent.stream(messages)`
  // overload at agent.d.ts:860 returns `Promise<MastraModelOutput<OUTPUT>>`
  // which exposes `textStream` and `object` (output.d.ts:236, 252).
  type MastraShape<T> = {
    generate: (prompt: string) => Promise<{ object: T }>;
    stream: (prompt: string) => Promise<{
      textStream: ReadableStream<string> | AsyncIterable<string>;
      object: Promise<T>;
    }>;
  };
  const deps: RunTurnDeps = {
    narratorAgent: adaptMastraAgent(narratorAgent as unknown as MastraShape<NarratorOutput>),
    factionAgent: adaptMastraAgent(factionAgent as unknown as MastraShape<FactionOutput>),
    illustratorAgent: adaptMastraAgent(
      illustratorAgent as unknown as MastraShape<IllustratorOutput>,
    ),
    ttsRender,
    emit,
  };

  const result = await workflowRunTurn(workflowInput, deps);
  // All meaningful state already flowed through `emit` (done/error events).
  // RunTurnResult is informational; log diagnostically on error.
  if (result.status === 'error') {
    console.warn('[liveRunTurn] workflow returned error result:', result.message);
  }
}

// ----- top-level dispatcher -----------------------------------------------

export interface RunTurnOpts {
  /** Test/route DI: override the runner. */
  runner?: (input: RunTurnInput, emit: Emit) => Promise<void>;
}

export async function runTurn(
  input: RunTurnInput,
  emit: Emit,
  opts: RunTurnOpts = {},
): Promise<void> {
  if (opts.runner) return opts.runner(input, emit);
  if (process.env.RPG_RUNNER_MOCK === '1') return mockRunTurn(input, emit);
  return liveRunTurn(input, emit);
}

// ----- ask (OOC) live runner ----------------------------------------------

export async function liveRunAsk(input: RunAskInput, emit: Emit): Promise<void> {
  // Loremaster has no structured output schema, so its `.object` is unused —
  // `runAsk` only iterates `textStream`. The cast is safe because the adapter
  // narrows the Mastra `Agent` shape down to what `runAsk` actually reads;
  // do not remove the inline alias thinking it's cargo-cult — it exists to
  // tell TypeScript the resolved object type is `unknown`, not the agent's
  // richer FullOutput<unknown> / MastraModelOutput<unknown> wire shape.
  type MastraStreamShape = {
    generate: (prompt: string) => Promise<{ object: unknown }>;
    stream: (prompt: string) => Promise<{
      textStream: ReadableStream<string> | AsyncIterable<string>;
      object: Promise<unknown>;
    }>;
  };
  const adapted = adaptMastraAgent(loremasterAgent as unknown as MastraStreamShape);
  await askRunAsk(input, { loremasterAgent: adapted, emit });
}

// ----- ask (OOC) top-level dispatcher -------------------------------------

export interface RunAskOpts {
  /** Test/route DI: override the runner. */
  runner?: (input: RunAskInput, emit: Emit) => Promise<void>;
}

export async function runAsk(input: RunAskInput, emit: Emit, opts: RunAskOpts = {}): Promise<void> {
  if (opts.runner) return opts.runner(input, emit);
  if (process.env.RPG_RUNNER_MOCK === '1') return mockRunAsk(input, emit);
  return liveRunAsk(input, emit);
}

export type { RunAskInput, MockAskOpts };
export { mockRunAsk };
