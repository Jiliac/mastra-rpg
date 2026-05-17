// src/app/api/turn/route.ts
//
// POST /api/turn — bridges the turn workflow's PhaseEvent stream to an
// SSE response.
//
// Concurrency invariant #3 (spec lines 364-365): when the client
// disconnects, we stop draining events into the response body but we do
// NOT abort the workflow. The runner has no AbortSignal parameter; the
// abort handler here just flips a flag so subsequent `emit` calls
// become no-ops.

import { z } from 'zod';
import type { PhaseEvent } from '@/lib/sse/events';
import { serializeEvent, serializeHeartbeat } from '@/lib/sse/serialize';
import { runTurn, runAsk, type RunTurnInput, type RunAskInput, type Emit } from '@/lib/sse/runner';
import { classifierAgent } from '@/mastra/agents/classifier';
import type { ClassifierOutput } from '@/lib/schemas';

export const dynamic = 'force-dynamic';
// Node runtime — we depend on `node:fs` etc. via the runner's transitive imports.
export const runtime = 'nodejs';

export interface PostOpts {
  /** Test DI: override the canonical runner. */
  runner?: (input: RunTurnInput, emit: Emit) => Promise<void>;
  /** Test DI: override the OOC runner. */
  askRunner?: (input: RunAskInput, emit: Emit) => Promise<void>;
  /**
   * Test DI: override the classifier. Return `{ isOoc: boolean }` or throw to
   * exercise the fail-safe fallback. Defaults to `classifierAgent.generate(...)`.
   */
  classify?: (input: string) => Promise<ClassifierOutput>;
}

// Project rule (.coderabbit.yaml lines 176-179): route handlers must validate
// request bodies with zod before touching agents. This POST runs the workflow
// (touches all three agents via runner.ts), so the boundary is here.
const TurnBodySchema = z.object({
  slug: z.string().min(1, 'missing or empty slug'),
  input: z
    .string()
    .min(1, 'missing or empty input')
    .refine((s) => s.trim().length > 0, { message: 'missing or empty input' }),
});

type ParsedBody = z.infer<typeof TurnBodySchema>;

async function parseBody(req: Request): Promise<ParsedBody | { error: string }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { error: 'invalid JSON body' };
  }
  const parsed = TurnBodySchema.safeParse(body);
  if (!parsed.success) {
    // First issue message — keeps responses to the existing wire-format the
    // tests assert (`missing or empty slug` / `missing or empty input`).
    return { error: parsed.error.issues[0]?.message ?? 'invalid body' };
  }
  return parsed.data;
}

const SSE_HEADERS: HeadersInit = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  // Disables proxy buffering (nginx convention). Belt + suspenders for
  // dev-only localhost; harmless in production.
  'x-accel-buffering': 'no',
};

/**
 * Internal implementation. Exported for unit tests that need to inject
 * a mock runner; production code goes through the `POST` wrapper which
 * conforms to Next 16's `RouteHandlerConfig` constraint.
 */
async function defaultClassify(input: string): Promise<ClassifierOutput> {
  // `Agent.generate(messages, options)` returns FullOutput<T> where `.object`
  // is the parsed structured output (NarratorOutput/etc.). Cast through
  // unknown — Mastra's type surface for the short-form overload doesn't
  // structurally match ClassifierOutput here.
  const res = (await classifierAgent.generate(input)) as unknown as { object: ClassifierOutput };
  return res.object;
}

export async function handleTurnPost(req: Request, opts: PostOpts = {}): Promise<Response> {
  const parsed = await parseBody(req);
  if ('error' in parsed) {
    return new Response(parsed.error, { status: 400 });
  }

  // Fail-safe classifier: any throw or unexpected shape falls back to canonical.
  // Better to over-run the full pipeline than miss a real turn.
  const classify = opts.classify ?? defaultClassify;
  let isOoc = false;
  try {
    const verdict = await classify(parsed.input);
    isOoc = verdict.isOoc === true;
  } catch (err) {
    console.warn(
      `[turn route] classifier failed, defaulting to canonical:`,
      err instanceof Error ? err.message : String(err),
    );
    isOoc = false;
  }

  const encoder = new TextEncoder();
  // Heartbeat every 15s — long narrator pauses must not be killed by
  // intermediate proxies. 15s is well under the typical 30-60s idle
  // timeout. The interval is cleared on stream close.
  const HEARTBEAT_MS = 15_000;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let clientGone = false;
      let closed = false;

      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          // Controller is closed — flip the flag and move on.
          closed = true;
        }
      };

      const safeClose = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // ignore — already closed
        }
      };

      const emit: Emit = (ev) => {
        if (clientGone) return; // invariant #3: runner keeps running, we stop writing
        safeEnqueue(encoder.encode(serializeEvent(ev)));
      };

      const heartbeat = setInterval(() => {
        if (clientGone || closed) return;
        safeEnqueue(encoder.encode(serializeHeartbeat()));
      }, HEARTBEAT_MS);

      const onAbort = () => {
        clientGone = true;
        clearInterval(heartbeat);
        // Close the response stream so Next can release the connection.
        // We do NOT propagate this to the runner — that's the whole point.
        safeClose();
      };
      req.signal.addEventListener('abort', onAbort, { once: true });

      // Fire-and-forget. If the runner throws an unexpected error,
      // surface it as a final SSE error event.
      const dispatch = isOoc
        ? runAsk(parsed, emit, { runner: opts.askRunner })
        : runTurn(parsed, emit, { runner: opts.runner });
      const runPromise = dispatch.then(
        () => {
          clearInterval(heartbeat);
          safeClose();
        },
        (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          if (!clientGone) {
            safeEnqueue(
              encoder.encode(
                serializeEvent({
                  type: 'error',
                  message,
                  recoverable: false,
                } as PhaseEvent),
              ),
            );
          }
          clearInterval(heartbeat);
          safeClose();
        },
      );

      // We don't await — `start` returning resolves the Response, and
      // Next will keep the stream open until controller.close().
      void runPromise;
    },
  });

  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}

/**
 * Next 16 route handler. Delegates to `handleTurnPost` with no DI — the
 * default runner path is `runTurn(...)` which itself dispatches between
 * `mockRunTurn` (env-flagged) and `liveRunTurn`.
 */
export async function POST(req: Request): Promise<Response> {
  return handleTurnPost(req);
}
