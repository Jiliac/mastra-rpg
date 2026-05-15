# Wave 6 — API + UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the player-facing surface: a Next.js App Router POST endpoint at `src/app/api/turn/route.ts` that runs the Wave-5 turn workflow and bridges its `PhaseEvent` stream onto an HTTP `text/event-stream`, plus a client page at `src/app/play/[slug]/page.tsx` that posts the player input, renders a phase tape, streams narrator prose, and shows audio + image embeds when the turn completes. The pair must satisfy the four Wave-6 exit criteria from the spec (end-to-end turn at `localhost:3000/play/commodore-vex`; phase tape + streaming prose + final media; SSE disconnect does NOT abort the workflow; mutex contention surfaces as a recoverable error and disables the input).

**Architecture:** A thin `src/lib/sse/` module owns the wire format (`PhaseEvent` union, server-side serializer, client-side parser/state-reducer). The route handler at `src/app/api/turn/route.ts` constructs a `ReadableStream` that owns the workflow run; on `request.signal.abort` it does **NOT** abort the workflow (the spec's concurrency invariant #3 — client disconnect just stops writing to the response, the workflow continues to completion and persistence). The workflow is reached through a single seam `src/lib/sse/runner.ts` that exports `runTurn(input, emit)`; in production this imports `runTurn` directly from `@/mastra/workflows/turn` (the Wave-5 export) and constructs the workflow's `RunTurnDeps` (the three agents, `ttsRender`, and the `emit` callback) at call time. For Wave-6 (parallel-friendly even though Wave 5 is now merged) the runner remains **mockable** via `process.env.RPG_RUNNER_MOCK === '1'` which routes to a deterministic `mockRunTurn` that emits the canonical `PhaseEvent` sequence with timed `prose_delta` chunks. The route does **NOT** go through `mastra.getWorkflowById('turnWorkflow')` — direct import is simpler, gives strict typing, and matches how the workflow exports its public API. The client page composes existing `src/components/ai-elements/*` primitives (`Conversation`, `Message`, `MessageResponse`, `PromptInput`, `Task` family, `AudioPlayer` family, `Image`) plus three small new pieces: a `PhaseTape` (collapsible list of phases with status icons), a `MutexBanner` (alert when the server reports the slug is busy), and a `TurnImages` strip (renders the illustrator's images by `path`, served via a tiny `src/app/api/turn/image/route.ts` GET endpoint that streams files out of the vault root with a strict path-traversal guard). The whole UI lives in one client component because state is small and tightly coupled to the SSE reader.

**Tech Stack:** TypeScript (ES2022 strict), Next.js 16 App Router, React 19, `'use client'` for the page, native `fetch` + `ReadableStream` for the client-side SSE reader (no `EventSource`, because POST + body — `EventSource` only does GET), Web Streams `TextEncoder`/`TextDecoder`, vitest for node-only unit tests of the serializer/parser/runner-mock. No new runtime dependencies — every UI primitive and `streamdown` already ship in `package.json`.

**Source spec:** `docs/superpowers/specs/2026-05-10-mastra-rpg-runtime-port-design.md` — Wave 6 section (lines 583–599), High-level architecture (lines 24–63), Component layout boundaries for `src/app/api/turn/route.ts` and `src/app/play/[slug]/page.tsx` (lines 82–84, 129–131), Phase events SSE union (lines 286–297), UI breakdown sentence "UI shows the phase tape on the right column, prose streams in the main column, audio + images appear at done" (line 299), Concurrency invariant #3 "Workflow does NOT propagate the request's AbortSignal" (lines 364–365), Failure matrix rows for mutex contention (line 331), narrator-failed (line 335), image gen failure (line 336), illustrator-failed (line 337), TTS failure (line 338), filesystem write fails (line 340), workflow crash mid-turn (line 341), UI disconnects mid-stream (line 342), Out-of-band cleanup `src/app/page.tsx` "hello world chat" (lines 601–605).

**Wave-1/2/3/4 outputs you depend on (already merged, do NOT modify):**

- `src/lib/schemas.ts` — exports the `ImageMeta` Zod schema and inferred TS type. The `done` event embeds `images: ImageMeta[]` so the UI's `TurnImages` can iterate `.path`, `.filename`, `.prompt`, `.slug`. Imported as `import type { ImageMeta } from '@/lib/schemas';`.
- `src/lib/vault/paths.ts` — exports `vaultRoot(slug: string)` returning `<cwd>/vaults/<slug>`. The image-serving route uses this plus `path.resolve` + a prefix-equality check on the resolved path to refuse traversal (`../../etc/passwd`).
- `src/mastra/index.ts` — exports `mastra`. Wave 5 already registered the three agents under the keys `narratorAgent`, `factionAgent`, `illustratorAgent` (verified at line 18 of `src/mastra/index.ts`). The Wave-6 runner imports those agents **directly** from their source modules (`@/mastra/agents/narrator`, `@/mastra/agents/faction`, `@/mastra/agents/illustrator`) rather than going through the Mastra registry — direct imports give strict typing and skip the runtime `getAgentById` lookup. **Do not edit `src/mastra/index.ts` in Wave 6.**

**Wave-5 contract (now MERGED at commit `f36cd02`):** the runner imports `runTurn`, `PhaseEvent`, `PhaseEventEmitter`, `RunTurnInput`, and `RunTurnDeps` directly from `@/mastra/workflows/turn`. Wave 5's `runTurn(input, deps)` accepts `{ vaultRoot: string; playerInput: string }` (note: **`vaultRoot` — an absolute path — not `slug`; `playerInput` not `input`**) plus a `RunTurnDeps` bag containing the three agents (shape: `AgentLike<T> = { generate(prompt: string): Promise<{ object: T }>; stream(prompt: string): Promise<AgentStreamLike<T>> }`), `ttsRender`, an `emit: PhaseEventEmitter` callback, and an optional `now` clock. All `PhaseEvent` emissions flow through `deps.emit` synchronously during the run. The resolved `RunTurnResult` (`{ status: 'success', ... } | { status: 'error', message, recoverable }`) is informational only — the meaningful state already flowed through `emit`. To preserve compile-time decoupling and keep the wire format singular, the local `src/lib/sse/events.ts` **re-exports** the type rather than duplicating it (`export { type PhaseEvent } from '@/mastra/workflows/turn'`) and keeps the `isPhaseEvent` runtime guard local (Wave 5 doesn't ship one).

**What's already on disk in this branch (informational, not to be modified):**

- `src/mastra/index.ts` registers `{ narratorAgent, factionAgent, illustratorAgent }` (Wave 4). `workflows` is intentionally unconfigured — Wave 5 adds it back.
- `src/app/page.tsx` is the create-next-app default landing page. The spec's out-of-band cleanup section calls it out as "delete or repurpose"; Wave 6 deletes it (Task 9) and adds a tiny placeholder redirect to `/play/<VAULT_SLUG>` so `localhost:3000` still does something useful.
- `src/app/chat/page.tsx` + `src/app/api/chat/route.ts` are the leftover weather chat scaffold. They reference `mastra.getAgentById('weather-agent')`, which no longer exists post-Wave-4. They throw at request time but compile clean (it's a runtime `getAgentById` lookup). **Out of scope for this plan** — they're dead code, but the Wave-4 cleanup spec ticket explicitly bounded itself to weather *agents/tools/workflows*; the leftover `/chat` route + `/api/chat` belong to a future janitorial pass. Wave 6 leaves them alone to avoid scope creep.
- `tests/fixtures/test-vault/` exists with the minimal vault from Wave 1; Wave 6 needs no new fixtures.
- `vitest.config.ts` has `environment: 'node'` (no jsdom/happy-dom installed). Wave 6 unit tests must be node-only: SSE serializer/parser, runner-mock, the image route's traversal guard. Component render tests would require a new dev dep (`jsdom`) plus a Vitest project split (because the workflow + Mastra import path is hostile to a browser env); to honor "no new deps" the UI is verified by the spec-mandated manual browser smoke test (lines 410–418 + Wave-6 exit criteria), and the testable component logic is extracted into a pure reducer (`reducePhaseEvent`) which IS node-testable.

**Confirmed Next.js 16 App Router shape (verified against `node_modules/next/dist/server/route-modules`):**

- A `route.ts` file under `src/app/api/.../route.ts` exports `GET` / `POST` / etc. functions of signature `(req: Request, ctx: { params: Promise<...> }) => Response | Promise<Response>`. `params` is a Promise in Next 16 (it WAS a sync object in Next 14 and earlier — verified against `next@16.2.6`'s `route-handlers.d.ts`). For our POST at `src/app/api/turn/route.ts` we do not use `params`; for the GET at `src/app/api/turn/image/route.ts` we type the second arg explicitly.
- Returning `new Response(stream, { headers })` where `stream` is a `ReadableStream<Uint8Array>` is the App Router's idiomatic SSE pattern. There is no `pages/api`-style `res.write`.
- `export const dynamic = 'force-dynamic'` on the route file prevents Next from attempting static optimization for an endpoint that streams a unique response per request.
- `request.signal` is an `AbortSignal` that fires when the client disconnects. To honor concurrency invariant #3 we **read `request.signal.aborted` only to stop writing to the response** — we do not pass it to the runner, so the workflow runs to completion in background.

---

## Pre-flight check (informational — do NOT re-run if green)

Before starting, verify Waves 1–4 are in place. If anything below is missing or has drifted, **stop and report** rather than fix inline — those are separate tickets.

- [ ] **Verify Wave-1/2/3/4 source files exist.**

```bash
ls src/lib/schemas.ts src/lib/dossier.ts src/lib/vault/paths.ts \
   src/mastra/agents/narrator.ts src/mastra/agents/faction.ts src/mastra/agents/illustrator.ts \
   src/mastra/tools/dice.ts src/mastra/tools/loadEntity.ts src/mastra/tools/image.ts \
   src/mastra/index.ts
```

Expected: all 10 paths listed. If any missing, abort.

- [ ] **Verify all existing tests pass on a clean tree.**

```bash
pnpm test --run
```

Expected: green. If anything fails, abort — Wave 6 must build on a green baseline.

- [ ] **Verify the working tree is clean on the wave-6 branch.**

```bash
git status -uno && git rev-parse --abbrev-ref HEAD
```

Expected: clean tree, branch `auto/2026-05-10-mastra-rpg-runtime-port-design-wave-6`.

- [ ] **Verify the vault symlink resolves.**

```bash
ls vaults/commodore-vex/ | head -5
```

Expected: 5+ entries, including `world.xml`, `journal.md`. If broken, abort — the live smoke test won't work either.

- [ ] **Note whether the Wave-5 workflow exists yet.**

```bash
test -f src/mastra/workflows/turn.ts && echo W5_PRESENT || echo W5_ABSENT
```

Either output is valid for Wave 6. If `W5_PRESENT`, Task 4 wires the runner against it; if `W5_ABSENT`, Task 4 keeps the runner in mock-only mode and Wave 5 finishes the wiring at merge time. Either way, the page + route ship complete.

---

## File structure

Production files (all new):

| File                                | Responsibility                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `src/lib/sse/events.ts`             | Re-exports `PhaseEvent` from `@/mastra/workflows/turn` (Wave 5's source of truth) and provides a local `isPhaseEvent(x: unknown)` runtime guard. No I/O. Single re-export line plus the guard implementation.                                                                                                                                                              |
| `src/lib/sse/serialize.ts`          | `serializeEvent(ev: PhaseEvent): string` returns one SSE record (`event: <type>\ndata: <json>\n\n`). `serializeHeartbeat(): string` returns `: heartbeat\n\n` (comment line — keeps proxies happy across long narrator pauses).                                                                                                                                          |
| `src/lib/sse/parse.ts`              | Pure parser: `parseSseChunks(buffer: string): { events: PhaseEvent[]; rest: string }`. Splits on `\n\n`, decodes each record's `event:` + `data:` lines, JSON-parses the payload, runs `isPhaseEvent` guard, drops malformed records. Used by the client reader.                                                                                                          |
| `src/lib/sse/reducer.ts`            | Pure UI state reducer: `initialState()` + `reducePhaseEvent(state, ev): UiState`. Owns phase-tape state, accumulated prose, accumulated images, error state, done state. Node-testable — no React, no DOM.                                                                                                                                                              |
| `src/lib/sse/runner.ts`             | The Wave-5/Wave-6 seam. Exports `runTurn(opts, emit): Promise<void>`. In `mock` mode (env flag or DI), emits a canonical event sequence with timed `prose_delta`s. In `live` mode, calls `runTurn` imported directly from `@/mastra/workflows/turn`, constructing the workflow's `RunTurnDeps` from the three agent module imports plus `ttsRender` and the `emit` callback. Crucially: **never accepts an `AbortSignal`** — concurrency invariant #3 is structural. |
| `src/app/api/turn/route.ts`         | `POST` handler. Reads `{ slug, input }` JSON body, creates a `ReadableStream`, kicks off `runTurn` (fire-and-forget; does NOT await), pipes its emissions through `serializeEvent` into the stream. Returns `new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', 'connection': 'keep-alive', 'x-accel-buffering': 'no' } })`. On `request.signal.abort` (client disconnect), closes the stream's writer but lets `runTurn` continue. |
| `src/app/api/turn/image/route.ts`   | `GET` handler. Reads `?slug=<slug>&filename=<name>` query, resolves to `<vaultRoot(slug)>/images/<name>`, runs a strict prefix-equality check on the resolved absolute path, streams the file with `content-type: image/png`. 404s on traversal attempt or missing file. (Why a route: vault images live outside `public/`; we don't want Next to copy them, and the path is a runtime input.) |
| `src/app/api/turn/audio/route.ts`   | `GET` handler. Same shape as the image route but serves `<vaultRoot(slug)>/audio/<name>` with `content-type: audio/ogg`. Used by `<AudioPlayerElement src=...>` on `done`.                                                                                                                                                                                              |
| `src/app/play/[slug]/page.tsx`      | Server component shell that reads `params.slug` and renders `<PlayClient slug={slug} />`. Five lines.                                                                                                                                                                                                                                                                  |
| `src/app/play/[slug]/play-client.tsx` | The client component. Owns: an input form (uses `PromptInput`), the SSE fetch + `parseSseChunks` reader loop, a `useReducer` over `reducePhaseEvent`, render of `Conversation` + `Message` + `MessageResponse` (streaming prose), a `<PhaseTape>` column, a `<MutexBanner>`, a `<TurnImages>` strip, and `<AudioPlayer>` for the rendered narrator audio. |
| `src/app/play/[slug]/phase-tape.tsx` | Small dumb component. Takes `phases: PhaseRecord[]` from reducer state and renders the spec's "phase tape on the right column" using the existing `Task` / `TaskTrigger` / `TaskItem` primitives from `src/components/ai-elements/task.tsx`.                                                                                                                            |
| `src/app/play/[slug]/turn-images.tsx` | Small dumb component. Takes `images: ImageMeta[]` (subset of the `done` event payload) and a slug, renders an inline grid using `<img src={`/api/turn/image?slug=${slug}&filename=${img.filename}`}>` (we don't reach for the `<Image>` ai-element here because it expects base64 data URIs, not URLs).                                                                  |
| `src/app/play/[slug]/mutex-banner.tsx` | Small dumb component. Takes `{ visible, message }` and renders a `<Alert>` from `src/components/ui/alert.tsx`. Hidden when `!visible`.                                                                                                                                                                                                                                  |
| `src/app/page.tsx` (rewrite)        | Out-of-band cleanup. Replace the create-next-app default content with a server component that reads `process.env.VAULT_SLUG` and `redirect()`s to `/play/<slug>` (or renders a small fallback if the env is unset).                                                                                                                                                     |

Test files (new, node-only):

| File                                    | Coverage                                                                                                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/sse/serialize.test.ts`         | Every variant of `PhaseEvent` round-trips through `serializeEvent` → `parseSseChunks` and matches the source object. `serializeHeartbeat` returns the literal `: heartbeat\n\n`.          |
| `src/lib/sse/parse.test.ts`             | Multi-record chunk; partial trailing record returned as `rest`; malformed JSON dropped; unknown event type dropped; empty buffer returns `{ events: [], rest: '' }`.                      |
| `src/lib/sse/reducer.test.ts`           | `phase` events append to tape and mark previous phase done; `prose_delta` events concatenate; `done` event captures `audioPath`/`images` + flips state to `done`; `error` event captures `recoverable`. |
| `src/lib/sse/runner.test.ts`            | `mockRunTurn` emits the canonical sequence in order (`phase: factions` → `phase: narrator` → 3+ `prose_delta` → `phase: media` → `phase: persist` → `done`); never emits `error` in default mode; the `MOCK_FAIL=mutex` flag emits the spec's mutex-contention `error`. |
| `src/app/api/turn/route.test.ts`        | The route returns `200` with the right `Content-Type` header on a valid POST; returns `400` on a missing body field; the response stream contains the mock runner's serialized events in order; when the client disconnects mid-stream, `runTurn`'s `emit` keeps being invoked (drained into `/dev/null`) — verifies concurrency invariant #3 from the route's side. |
| `src/app/api/turn/image/route.test.ts`  | Resolves a valid `?slug&filename` to a 200 + bytes; rejects `../../etc/passwd` with 404; rejects an absolute filename with 404; rejects unknown slug with 404.                            |

**Why no React/JSX tests:** vitest's `environment: 'node'` is what's configured, and adding `jsdom`/`@testing-library` would mean a new dev dep + a multi-project vitest config (because the route handlers + the Mastra import graph fall over in a browser env). The spec's exit criteria for Wave 6 are explicitly behavioral ("Browser at localhost:3000/play/commodore-vex plays a full turn end-to-end") and verified manually. All non-trivial UI logic is extracted into `reducer.ts` and tested in node.

---

## Task 1: SSE event types and serializer

**Files:**

- Create: `src/lib/sse/events.ts`
- Create: `src/lib/sse/serialize.ts`
- Create: `src/lib/sse/serialize.test.ts`

The `PhaseEvent` union is the contract Wave 6 ships against. Codify it once, in TS, so the route, the runner, the reducer, and the tests all import the same type.

**Wire format reminder (spec lines 288–297 + standard SSE per HTML Living Standard):**

```
event: phase\ndata: {"type":"phase","name":"factions","count":2}\n\n
event: prose_delta\ndata: {"type":"prose_delta","text":"It begins..."}\n\n
event: done\ndata: {"type":"done","audioPath":"...","finalProse":"...","images":[...]}\n\n
```

- One record = `event: <type>\ndata: <json>\n\n`. The trailing blank line is mandatory.
- Heartbeats use comment syntax: `: heartbeat\n\n`. Comments are ignored by both `EventSource` and our hand-rolled parser; they exist to keep proxies / load balancers from killing idle connections.
- We do NOT use `id:` lines (no resumption semantics — the workflow is a one-shot per turn).

- [ ] **Step 1: Write the failing test.**

Create `src/lib/sse/serialize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { PhaseEvent } from './events';
import { serializeEvent, serializeHeartbeat } from './serialize';
import { parseSseChunks } from './parse';

describe('serializeEvent', () => {
  it('round-trips phase factions', () => {
    const ev: PhaseEvent = { type: 'phase', name: 'factions', count: 3 };
    const wire = serializeEvent(ev);
    expect(wire).toBe(
      `event: phase\ndata: {"type":"phase","name":"factions","count":3}\n\n`,
    );
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
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm test --run src/lib/sse/serialize.test.ts
```

Expected: FAIL with `Cannot find module './events'` (or similar — files don't exist yet).

- [ ] **Step 3: Create `events.ts`.**

```ts
// src/lib/sse/events.ts
//
// The PhaseEvent union is the wire contract between the turn workflow
// (Wave 5) and the chat UI (Wave 6). Wave 5 owns the type definition;
// we re-export it here so the SSE module has a single import path
// (`@/lib/sse/events`) for both the type and the runtime guard.

export { type PhaseEvent } from '@/mastra/workflows/turn';
import type { PhaseEvent } from '@/mastra/workflows/turn';

export type PhaseName = 'factions' | 'narrator' | 'media' | 'persist';

const PHASE_NAMES = new Set<PhaseName>(['factions', 'narrator', 'media', 'persist']);

/** Cheap runtime guard for parsed JSON. Used by the SSE parser to drop garbage. */
export function isPhaseEvent(x: unknown): x is PhaseEvent {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  switch (o.type) {
    case 'phase':
      return typeof o.name === 'string' && PHASE_NAMES.has(o.name as PhaseName);
    case 'prose_delta':
      return typeof o.text === 'string';
    case 'done':
      return (
        typeof o.audioPath === 'string' &&
        typeof o.finalProse === 'string' &&
        Array.isArray(o.images)
      );
    case 'error':
      return typeof o.message === 'string' && typeof o.recoverable === 'boolean';
    default:
      return false;
  }
}
```

- [ ] **Step 4: Create `serialize.ts`.**

```ts
// src/lib/sse/serialize.ts
//
// Serialize a PhaseEvent to a single SSE record. SSE wire format per the
// HTML Living Standard "Server-sent events" section:
//
//   event: <type>\n
//   data: <single-line JSON>\n
//   \n                                   <- trailing blank line is mandatory
//
// A heartbeat is a comment record:
//
//   : heartbeat\n
//   \n

import type { PhaseEvent } from './events';

export function serializeEvent(ev: PhaseEvent): string {
  // JSON.stringify never emits a literal newline, so a single `data: ...` line
  // is always sufficient. No need to split multi-line payloads.
  return `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;
}

export function serializeHeartbeat(): string {
  return `: heartbeat\n\n`;
}
```

- [ ] **Step 5: The test still fails — `parseSseChunks` doesn't exist yet. Stub it minimally so this test file compiles, then move to Task 2.**

Create `src/lib/sse/parse.ts` with a temporary trivial body:

```ts
// src/lib/sse/parse.ts (Task 2 will fill this in)
import type { PhaseEvent } from './events';

export interface ParseResult {
  events: PhaseEvent[];
  rest: string;
}

export function parseSseChunks(_buffer: string): ParseResult {
  throw new Error('not implemented yet — see Task 2');
}
```

- [ ] **Step 6: Run the serialize test again to confirm it now fails for the right reason.**

```bash
pnpm test --run src/lib/sse/serialize.test.ts
```

Expected: tests that don't call `parseSseChunks` (`serializeHeartbeat`, the first half of each round-trip assertion) PASS the `expect(wire).toBe(...)` part but FAIL at `parseSseChunks` with `not implemented yet`. That's the bookmark for Task 2.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/sse/events.ts src/lib/sse/serialize.ts src/lib/sse/parse.ts src/lib/sse/serialize.test.ts
git commit -m "wave-6(sse): PhaseEvent union + serializer + parse stub"
```

---

## Task 2: SSE parser

**Files:**

- Modify: `src/lib/sse/parse.ts` (replace stub)
- Create: `src/lib/sse/parse.test.ts`

The parser is intentionally tolerant: malformed records get dropped silently. This matches `EventSource`'s real-world behavior and means a transient bad chunk doesn't poison the rest of the stream.

- [ ] **Step 1: Write the failing test.**

Create `src/lib/sse/parse.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm test --run src/lib/sse/parse.test.ts
```

Expected: FAIL with `not implemented yet`.

- [ ] **Step 3: Implement the parser.**

Replace `src/lib/sse/parse.ts` body:

```ts
// src/lib/sse/parse.ts
//
// SSE parser. Splits a string buffer on the SSE record separator (\n\n),
// pulls `event:` and `data:` lines out of each record, JSON-decodes the
// data, runs a runtime guard, and returns a list of typed PhaseEvents
// plus any trailing partial record (which the caller prepends to the
// next chunk).
//
// Tolerant by design: malformed records are silently dropped.

import type { PhaseEvent } from './events';
import { isPhaseEvent } from './events';

export interface ParseResult {
  events: PhaseEvent[];
  rest: string;
}

export function parseSseChunks(buffer: string): ParseResult {
  if (buffer === '') return { events: [], rest: '' };

  const events: PhaseEvent[] = [];
  const records = buffer.split('\n\n');
  // The last element after split is either '' (buffer ends with \n\n — fully consumed)
  // or a partial trailing record we have to hold for the next chunk.
  const rest = records.pop() ?? '';

  for (const rec of records) {
    if (rec === '') continue;
    // Comment records start with ':' — skip wholesale.
    if (rec.startsWith(':')) continue;

    let data: string | null = null;
    for (const line of rec.split('\n')) {
      if (line.startsWith('data:')) {
        // SSE spec: strip a single leading space after the colon if present.
        data = line.slice(5).replace(/^ /, '');
      }
      // We intentionally do NOT trust the `event:` line — `isPhaseEvent`
      // re-derives type from the JSON payload. (The two should agree;
      // if they don't, the JSON wins and the record is treated normally.)
    }
    if (data === null) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }
    if (!isPhaseEvent(parsed)) continue;
    events.push(parsed);
  }

  return { events, rest };
}
```

- [ ] **Step 4: Run all SSE tests.**

```bash
pnpm test --run src/lib/sse/
```

Expected: all serialize + parse tests PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/sse/parse.ts src/lib/sse/parse.test.ts
git commit -m "wave-6(sse): parser with PhaseEvent guard + partial-record buffering"
```

---

## Task 3: UI state reducer

**Files:**

- Create: `src/lib/sse/reducer.ts`
- Create: `src/lib/sse/reducer.test.ts`

The reducer is the entire non-trivial part of the UI logic. By extracting it from the React component we get it node-testable without jsdom; the React side then becomes a thin `useReducer` shell.

**State shape:**

```ts
type PhaseStatus = 'pending' | 'active' | 'done';

interface PhaseRecord {
  name: 'factions' | 'narrator' | 'media' | 'persist';
  status: PhaseStatus;
  count?: number; // only for factions
}

interface UiState {
  phases: PhaseRecord[]; // append-only as phases announce themselves
  prose: string; // concatenated narrator prose deltas
  finalProse: string | null; // set on `done`
  audioPath: string | null;
  images: ImageMeta[];
  error: { message: string; recoverable: boolean } | null;
  status: 'idle' | 'streaming' | 'done' | 'error';
}
```

**Transitions:**

- From `idle` (initial): a `phase` event transitions to `streaming` and appends the first phase as `active`.
- A subsequent `phase` event marks any previous `active` phase as `done` and appends the new phase as `active`.
- A `prose_delta` event concatenates onto `prose`.
- A `done` event marks the last `active` phase `done`, captures `audioPath` + `images` + `finalProse`, and flips `status` to `done`.
- An `error` event captures the error and flips `status` to `error`. If `recoverable=true`, the UI re-enables input; if `recoverable=false`, the UI stays disabled.

- [ ] **Step 1: Write the failing test.**

Create `src/lib/sse/reducer.test.ts`:

```ts
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
        images: [
          { filename: 'a.png', path: '/abs/images/a.png', prompt: 'p', slug: 's' },
        ],
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
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm test --run src/lib/sse/reducer.test.ts
```

Expected: FAIL with `Cannot find module './reducer'`.

- [ ] **Step 3: Implement the reducer.**

Create `src/lib/sse/reducer.ts`:

```ts
// src/lib/sse/reducer.ts
//
// Pure UI state reducer over PhaseEvent. Extracted from the React
// component so it can be node-tested without jsdom.

import type { PhaseEvent } from './events';
import type { ImageMeta } from '@/lib/schemas';

export type PhaseStatus = 'pending' | 'active' | 'done';

export interface PhaseRecord {
  name: 'factions' | 'narrator' | 'media' | 'persist';
  status: PhaseStatus;
  count?: number;
}

export interface UiState {
  phases: PhaseRecord[];
  prose: string;
  finalProse: string | null;
  audioPath: string | null;
  images: ImageMeta[];
  error: { message: string; recoverable: boolean } | null;
  status: 'idle' | 'streaming' | 'done' | 'error';
}

export function initialState(): UiState {
  return {
    phases: [],
    prose: '',
    finalProse: null,
    audioPath: null,
    images: [],
    error: null,
    status: 'idle',
  };
}

function markActiveDone(phases: PhaseRecord[]): PhaseRecord[] {
  return phases.map((p) => (p.status === 'active' ? { ...p, status: 'done' as const } : p));
}

export function reducePhaseEvent(state: UiState, ev: PhaseEvent): UiState {
  switch (ev.type) {
    case 'phase': {
      const newRecord: PhaseRecord = {
        name: ev.name,
        status: 'active',
        ...(ev.name === 'factions' ? { count: ev.count } : {}),
      };
      return {
        ...state,
        status: 'streaming',
        phases: [...markActiveDone(state.phases), newRecord],
      };
    }
    case 'prose_delta':
      return { ...state, prose: state.prose + ev.text };
    case 'done':
      return {
        ...state,
        status: 'done',
        phases: markActiveDone(state.phases),
        finalProse: ev.finalProse,
        audioPath: ev.audioPath,
        images: ev.images,
      };
    case 'error':
      return {
        ...state,
        status: 'error',
        error: { message: ev.message, recoverable: ev.recoverable },
      };
  }
}
```

- [ ] **Step 4: Run the reducer tests.**

```bash
pnpm test --run src/lib/sse/reducer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/sse/reducer.ts src/lib/sse/reducer.test.ts
git commit -m "wave-6(sse): UiState reducer over PhaseEvent (pure, node-testable)"
```

---

## Task 4: Runner seam (mock + live)

**Files:**

- Create: `src/lib/sse/runner.ts`
- Create: `src/lib/sse/runner.test.ts`

`runTurn` is the entire Wave-5/Wave-6 contract. It takes the player's input + slug, and an emit callback, and produces the `PhaseEvent` sequence. In mock mode it's a deterministic function we can fully unit-test; in live mode it delegates to `mastra.getWorkflowById('turnWorkflow')` and reduces the workflow's run stream to `PhaseEvent`s.

**Mock canonical sequence (the spec's happy path):**

```
phase: factions count=2
phase: narrator
prose_delta "It begins. "
prose_delta "Kessha turns. "
prose_delta "The harbor wind picks up."
phase: media
phase: persist
done audioPath=/mock/audio.ogg images=[]
```

**Why the runner exists as its own module, not inlined in the route:**

1. Lets the route be tested without a real workflow (Task 6 imports `runner` and stubs it).
2. Makes the Wave-5 swap surgical — one file changes, no edits to the route or the UI.
3. Centralizes concurrency invariant #3: the runner has no `AbortSignal` parameter. There's no API to pass one. Future maintainers can't accidentally violate the invariant.

- [ ] **Step 1: Write the failing test.**

Create `src/lib/sse/runner.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
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
    expect(emitted).toEqual([
      { type: 'error', message: 'still working', recoverable: true },
    ]);
  });

  it('runner does not accept an AbortSignal (compile-time contract)', () => {
    // This is a type-level assertion: mockRunTurn's third param is MockOpts,
    // which has no `signal` field. If a future edit adds one, the
    // `@ts-expect-error` below will go cold and the build will fail.
    // @ts-expect-error — MockOpts has no `signal` field by design
    void ((): Parameters<typeof mockRunTurn>[2] => ({ signal: new AbortController().signal }));
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm test --run src/lib/sse/runner.test.ts
```

Expected: FAIL with `Cannot find module './runner'`.

- [ ] **Step 3: Implement the runner.**

Create `src/lib/sse/runner.ts`:

```ts
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
// Mode selection: `runTurn` checks for an injected runner in opts (used
// by tests) or `process.env.RPG_RUNNER_MOCK === '1'` (used during W6
// parallel development before W5 lands), otherwise calls the live
// workflow via `mastra.getWorkflowById('turnWorkflow')`.

import type { PhaseEvent } from './events';

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
    emit({ type: 'error', message: 'narrator failed; please rephrase', recoverable: true });
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
 * Live runner. Wave 5 is MERGED (commit `f36cd02`) — this is the REAL
 * body, not a stub. The implementer MUST verify `AgentLike<T>`
 * structural compatibility with Mastra's concrete `Agent` class at
 * code-write time. If `narratorAgent` does not structurally assign to
 * `AgentLike<NarratorOutput>` (because Mastra's `generate`/`stream`
 * returns extra fields or different shapes), write a tiny adapter
 * `adaptMastraAgent<T>(agent): AgentLike<T>` (~10 LOC) and wrap each
 * agent before passing into `deps`.
 */
import {
  runTurn as workflowRunTurn,
  type RunTurnInput as WorkflowInput,
  type RunTurnDeps,
} from '@/mastra/workflows/turn';
import { narratorAgent } from '@/mastra/agents/narrator';
import { factionAgent } from '@/mastra/agents/faction';
import { illustratorAgent } from '@/mastra/agents/illustrator';
import { vaultRoot } from '@/lib/vault/paths';
import { ttsRender } from '@/lib/media/tts';

export async function liveRunTurn(input: RunTurnInput, emit: Emit): Promise<void> {
  const workflowInput: WorkflowInput = {
    vaultRoot: vaultRoot(input.slug),
    playerInput: input.input,
  };
  const deps: RunTurnDeps = {
    // If the three lines below fail TypeScript: write a tiny adapter
    //   `adaptMastraAgent<T>(agent: Agent): AgentLike<T>` that wraps
    //   `agent.generate({ prompt, output: Z })` → `{ object }` and
    //   `agent.stream(...)` → `{ textStream, object }`. ~10 LOC.
    narratorAgent,
    factionAgent,
    illustratorAgent,
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
```

- [ ] **Step 4: Run the runner tests.**

```bash
pnpm test --run src/lib/sse/runner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/sse/runner.ts src/lib/sse/runner.test.ts
git commit -m "wave-6(sse): runTurn seam — mock-first, live-stub for W5 swap"
```

---

## Task 5: Image + audio file routes

**Files:**

- Create: `src/app/api/turn/image/route.ts`
- Create: `src/app/api/turn/audio/route.ts`
- Create: `src/app/api/turn/image/route.test.ts`

The vault lives outside `public/`, so we can't rely on Next's static serving. These two routes stream the bytes back, with strict path-traversal guards. Both routes are tiny mirror images of each other; we ship + test the image one and the audio one is the same code with two strings changed.

**Path-traversal guard:**

```ts
const root = path.resolve(vaultRoot(slug), 'images');
const requested = path.resolve(root, filename);
if (!requested.startsWith(root + path.sep) && requested !== root) {
  return new Response('not found', { status: 404 });
}
```

`path.resolve` normalizes `..` segments, and the `startsWith(root + path.sep)` check guarantees the resolved file is strictly under `root` (the `+ path.sep` rejects sibling directories that happen to share a prefix, e.g. `images-evil/foo`).

- [ ] **Step 1: Write the failing test.**

Create `src/app/api/turn/image/route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GET } from './route';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

// We point the vault root at a tmp dir for the duration of the test.
// `vaultRoot(slug)` returns `<cwd>/vaults/<slug>`, so we create the
// expected layout under a temp `vaults/` we chdir into.
const ORIGINAL_CWD = process.cwd();
const TMP = path.join(ORIGINAL_CWD, '.tmp-turn-image-route-test');
const SLUG = 'fixture';
const IMG_DIR = path.join(TMP, 'vaults', SLUG, 'images');

beforeAll(async () => {
  await mkdir(IMG_DIR, { recursive: true });
  await writeFile(path.join(IMG_DIR, 'ok.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  process.chdir(TMP);
});

afterAll(async () => {
  process.chdir(ORIGINAL_CWD);
  await rm(TMP, { recursive: true, force: true });
});

function req(qs: string): Request {
  return new Request(`http://test/api/turn/image?${qs}`);
}

describe('GET /api/turn/image', () => {
  it('serves a valid file', async () => {
    const res = await GET(req(`slug=${SLUG}&filename=ok.png`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0x89);
  });

  it('rejects path traversal', async () => {
    const res = await GET(req(`slug=${SLUG}&filename=../../../etc/passwd`));
    expect(res.status).toBe(404);
  });

  it('rejects an absolute filename', async () => {
    const res = await GET(req(`slug=${SLUG}&filename=/etc/passwd`));
    expect(res.status).toBe(404);
  });

  it('404s on missing file', async () => {
    const res = await GET(req(`slug=${SLUG}&filename=does-not-exist.png`));
    expect(res.status).toBe(404);
  });

  it('400s on missing slug or filename', async () => {
    expect((await GET(req(`filename=ok.png`))).status).toBe(400);
    expect((await GET(req(`slug=${SLUG}`))).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm test --run src/app/api/turn/image/route.test.ts
```

Expected: FAIL with `Cannot find module './route'`.

- [ ] **Step 3: Implement the image route.**

Create `src/app/api/turn/image/route.ts`:

```ts
// src/app/api/turn/image/route.ts
//
// GET /api/turn/image?slug=<slug>&filename=<name>
//
// Streams an image file out of `<vaultRoot(slug)>/images/<name>` with a
// strict path-traversal guard. Used by the chat UI to render the
// illustrator's images, which live outside `public/` and therefore
// can't be served as static assets.

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { vaultRoot } from '@/lib/vault/paths';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug');
  const filename = url.searchParams.get('filename');
  if (!slug || !filename) {
    return new Response('missing slug or filename', { status: 400 });
  }

  const root = path.resolve(vaultRoot(slug), 'images');
  const requested = path.resolve(root, filename);
  if (!requested.startsWith(root + path.sep) && requested !== root) {
    return new Response('not found', { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(requested);
  } catch {
    return new Response('not found', { status: 404 });
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'private, max-age=3600',
    },
  });
}
```

- [ ] **Step 4: Run the image route tests.**

```bash
pnpm test --run src/app/api/turn/image/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Implement the audio route as a mirror.**

Create `src/app/api/turn/audio/route.ts`:

```ts
// src/app/api/turn/audio/route.ts
//
// GET /api/turn/audio?slug=<slug>&filename=<name>
//
// Mirror of /api/turn/image, serving `<vaultRoot(slug)>/audio/<name>` as
// `audio/ogg`. The Inworld TTS pipeline writes `.ogg` files (see Wave-3
// `src/lib/media/tts.ts`), so this is the only audio MIME type we need
// to handle for v0.

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { vaultRoot } from '@/lib/vault/paths';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug');
  const filename = url.searchParams.get('filename');
  if (!slug || !filename) {
    return new Response('missing slug or filename', { status: 400 });
  }

  const root = path.resolve(vaultRoot(slug), 'audio');
  const requested = path.resolve(root, filename);
  if (!requested.startsWith(root + path.sep) && requested !== root) {
    return new Response('not found', { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(requested);
  } catch {
    return new Response('not found', { status: 404 });
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'content-type': 'audio/ogg',
      'cache-control': 'private, max-age=3600',
      // Range requests aren't supported in v0 — the audio file is small
      // enough (one turn = ~30s of narrator prose) that a full GET is fine.
    },
  });
}
```

- [ ] **Step 6: Sanity-check by running all tests.**

```bash
pnpm test --run
```

Expected: full suite green, including the new image-route tests.

- [ ] **Step 7: Commit.**

```bash
git add src/app/api/turn/image/route.ts src/app/api/turn/image/route.test.ts \
        src/app/api/turn/audio/route.ts
git commit -m "wave-6(api): vault image + audio passthrough routes with traversal guards"
```

---

## Task 6: SSE route handler

**Files:**

- Create: `src/app/api/turn/route.ts`
- Create: `src/app/api/turn/route.test.ts`

This is the heart of the server side. The POST body is `{ slug: string, input: string }`. The handler:

1. Parses + validates the body. 400 on missing/empty fields.
2. Creates a `ReadableStream<Uint8Array>` with a `start(controller)` that:
   - Kicks off `runTurn(...)` without awaiting it.
   - Provides an `emit` that `controller.enqueue(encoder.encode(serializeEvent(ev)))`s.
   - When `runTurn` resolves, calls `controller.close()`.
   - When `runTurn` rejects with anything other than expected user errors, enqueues a final `error` event then closes.
3. Returns `new Response(stream, { headers: { 'content-type': 'text/event-stream', ... } })`.
4. Sets up a `request.signal.addEventListener('abort', ...)` that stops draining `emit` into the controller (but does NOT abort `runTurn`).

The "stops draining" detail is the entire concurrency-invariant-#3 enforcement: we toggle a `clientGone` boolean inside `emit`. After `clientGone === true`, `emit` is a no-op; `runTurn` keeps emitting; everything downstream of the workflow (journal append, image writes, audio render) still happens.

- [ ] **Step 1: Write the failing test.**

Create `src/app/api/turn/route.test.ts`:

```ts
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
    const res = await POST(
      postBody({ slug: 's', input: 'i' }, ac.signal),
      { runner },
    );

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
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm test --run src/app/api/turn/route.test.ts
```

Expected: FAIL with `Cannot find module './route'`.

- [ ] **Step 3: Implement the route.**

Create `src/app/api/turn/route.ts`:

```ts
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

import type { PhaseEvent } from '@/lib/sse/events';
import { serializeEvent, serializeHeartbeat } from '@/lib/sse/serialize';
import { runTurn, type RunTurnInput, type Emit } from '@/lib/sse/runner';

export const dynamic = 'force-dynamic';
// Node runtime — we depend on `node:fs` etc. via the runner's transitive imports.
export const runtime = 'nodejs';

interface PostOpts {
  /** Test DI: override the runner. */
  runner?: (input: RunTurnInput, emit: Emit) => Promise<void>;
}

interface ParsedBody {
  slug: string;
  input: string;
}

async function parseBody(req: Request): Promise<ParsedBody | { error: string }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { error: 'invalid JSON body' };
  }
  if (typeof body !== 'object' || body === null) {
    return { error: 'body must be an object' };
  }
  const o = body as Record<string, unknown>;
  if (typeof o.slug !== 'string' || o.slug.length === 0) {
    return { error: 'missing or empty slug' };
  }
  if (typeof o.input !== 'string' || o.input.trim().length === 0) {
    return { error: 'missing or empty input' };
  }
  return { slug: o.slug, input: o.input };
}

const SSE_HEADERS: HeadersInit = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  // Disables proxy buffering (nginx convention). Belt + suspenders for
  // dev-only localhost; harmless in production.
  'x-accel-buffering': 'no',
};

export async function POST(req: Request, opts: PostOpts = {}): Promise<Response> {
  const parsed = await parseBody(req);
  if ('error' in parsed) {
    return new Response(parsed.error, { status: 400 });
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
      const runPromise = runTurn(parsed, emit, { runner: opts.runner }).then(
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
```

- [ ] **Step 4: Run the route tests.**

```bash
pnpm test --run src/app/api/turn/route.test.ts
```

Expected: PASS, including the invariant-#3 test.

- [ ] **Step 5: Commit.**

```bash
git add src/app/api/turn/route.ts src/app/api/turn/route.test.ts
git commit -m "wave-6(api): POST /api/turn SSE bridge with detached workflow (invariant #3)"
```

---

## Task 7: Play page — small components

**Files:**

- Create: `src/app/play/[slug]/phase-tape.tsx`
- Create: `src/app/play/[slug]/turn-images.tsx`
- Create: `src/app/play/[slug]/mutex-banner.tsx`

Three dumb display components. Each one is small enough that we ship it complete in a single step and rely on the manual browser smoke test for verification (per the "no jsdom" note in the file-structure section). The point of separate files is hygiene: each one has one prop type and one return.

- [ ] **Step 1: Create `phase-tape.tsx`.**

```tsx
// src/app/play/[slug]/phase-tape.tsx
'use client';

import { Task, TaskContent, TaskItem, TaskTrigger } from '@/components/ai-elements/task';
import { Spinner } from '@/components/ui/spinner';
import { CheckIcon, CircleDashedIcon } from 'lucide-react';
import type { PhaseRecord } from '@/lib/sse/reducer';

const LABELS: Record<PhaseRecord['name'], string> = {
  factions: 'Factions',
  narrator: 'Narrator',
  media: 'Audio + images',
  persist: 'Persisting turn',
};

function PhaseRow({ phase }: { phase: PhaseRecord }) {
  const label =
    phase.name === 'factions' && phase.count !== undefined
      ? `${LABELS.factions} (${phase.count})`
      : LABELS[phase.name];
  return (
    <TaskItem>
      <span className="inline-flex items-center gap-2">
        {phase.status === 'done' ? (
          <CheckIcon className="size-4 text-emerald-500" aria-label="done" />
        ) : phase.status === 'active' ? (
          <Spinner className="size-4" aria-label="in progress" />
        ) : (
          <CircleDashedIcon className="size-4 text-muted-foreground" aria-label="pending" />
        )}
        <span>{label}</span>
      </span>
    </TaskItem>
  );
}

export function PhaseTape({ phases }: { phases: PhaseRecord[] }) {
  if (phases.length === 0) return null;
  return (
    <Task defaultOpen>
      <TaskTrigger title="Turn progress" />
      <TaskContent>
        {phases.map((p) => (
          <PhaseRow key={`${p.name}-${p.status}`} phase={p} />
        ))}
      </TaskContent>
    </Task>
  );
}
```

- [ ] **Step 2: Create `turn-images.tsx`.**

```tsx
// src/app/play/[slug]/turn-images.tsx
'use client';

import type { ImageMeta } from '@/lib/schemas';

export function TurnImages({ slug, images }: { slug: string; images: ImageMeta[] }) {
  if (images.length === 0) return null;
  return (
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {images.map((img) => (
        <figure key={img.filename} className="overflow-hidden rounded-md border">
          {/* eslint-disable-next-line @next/next/no-img-element -- vault images live outside `public/` and are served via /api/turn/image; next/image's loader would 404. */}
          <img
            src={`/api/turn/image?slug=${encodeURIComponent(slug)}&filename=${encodeURIComponent(img.filename)}`}
            alt={img.prompt}
            className="h-auto w-full"
          />
          <figcaption className="bg-muted/30 px-2 py-1 text-muted-foreground text-xs">
            {img.slug}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create `mutex-banner.tsx`.**

```tsx
// src/app/play/[slug]/mutex-banner.tsx
'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangleIcon } from 'lucide-react';

export function MutexBanner({
  visible,
  message,
}: {
  visible: boolean;
  message: string;
}) {
  if (!visible) return null;
  return (
    <Alert variant="default" className="mb-3">
      <AlertTriangleIcon className="size-4" />
      <AlertTitle>Still working on the previous turn</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
```

- [ ] **Step 4: TypeScript-check (no tests for these — they're JSX-only).**

```bash
pnpm build
```

Expected: succeeds. If it fails, fix the offending file and re-run; do not move on with a broken build.

- [ ] **Step 5: Commit.**

```bash
git add src/app/play/[slug]/phase-tape.tsx \
        src/app/play/[slug]/turn-images.tsx \
        src/app/play/[slug]/mutex-banner.tsx
git commit -m "wave-6(ui): phase tape, image grid, mutex banner display components"
```

---

## Task 8: Play page — client shell + server entry

**Files:**

- Create: `src/app/play/[slug]/page.tsx`
- Create: `src/app/play/[slug]/play-client.tsx`

The server entry is a five-line shell that awaits `params` and forwards `slug` to the client. The client is the SSE-driven UI.

**Client lifecycle:**

1. Mount: idle state, empty conversation.
2. User submits prompt: append a `user`-role message to the conversation, POST `{ slug, input }` to `/api/turn`, start reading the response body as SSE chunks.
3. For each chunk: split via `parseSseChunks`, fold events into `useReducer`'s state, append a streaming `assistant` message rendered with `MessageResponse` reading `state.prose`.
4. On `done`: keep the assistant message with `finalProse` (which has `![[image]]` embeds — `MessageResponse` is `Streamdown`-based and renders markdown; the obsidian-style embeds render as text, but we additionally render `<TurnImages>` + `<AudioPlayer>` below the message for the actual media).
5. On `error` with `recoverable=true`: show `<MutexBanner>` (or generic alert), re-enable input.
6. On `error` with `recoverable=false`: show the error, leave input disabled.

- [ ] **Step 1: Create the server entry.**

```tsx
// src/app/play/[slug]/page.tsx
//
// Server component. Awaits the Next-16 params Promise and forwards the
// slug to the client component, which owns all the SSE + UI state.

import { PlayClient } from './play-client';

export const dynamic = 'force-dynamic';

export default async function PlayPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <PlayClient slug={slug} />;
}
```

- [ ] **Step 2: Create the client component.**

```tsx
// src/app/play/[slug]/play-client.tsx
//
// The chat UI for one campaign. Posts turns to /api/turn, reads the SSE
// stream, folds events into a reducer, and renders:
//   - left column: conversation (user input + streaming narrator prose,
//     then audio + images at `done`)
//   - right column: phase tape

'use client';

import { useCallback, useReducer, useRef, useState } from 'react';
import { initialState, reducePhaseEvent, type UiState } from '@/lib/sse/reducer';
import { parseSseChunks } from '@/lib/sse/parse';
import type { PhaseEvent } from '@/lib/sse/events';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputBody,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
} from '@/components/ai-elements/prompt-input';
import {
  AudioPlayer,
  AudioPlayerControlBar,
  AudioPlayerDurationDisplay,
  AudioPlayerElement,
  AudioPlayerMuteButton,
  AudioPlayerPlayButton,
  AudioPlayerTimeDisplay,
  AudioPlayerTimeRange,
  AudioPlayerVolumeRange,
} from '@/components/ai-elements/audio-player';
import { PhaseTape } from './phase-tape';
import { TurnImages } from './turn-images';
import { MutexBanner } from './mutex-banner';

interface TurnRecord {
  id: string;
  userInput: string;
  state: UiState;
}

type Action =
  | { type: 'new-turn'; id: string; userInput: string }
  | { type: 'event'; id: string; ev: PhaseEvent };

function reduceTurns(turns: TurnRecord[], action: Action): TurnRecord[] {
  switch (action.type) {
    case 'new-turn':
      return [...turns, { id: action.id, userInput: action.userInput, state: initialState() }];
    case 'event':
      return turns.map((t) =>
        t.id === action.id ? { ...t, state: reducePhaseEvent(t.state, action.ev) } : t,
      );
  }
}

export function PlayClient({ slug }: { slug: string }) {
  const [turns, dispatch] = useReducer(reduceTurns, []);
  const [busy, setBusy] = useState(false);
  const [mutexMessage, setMutexMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const submit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed === '' || busy) return;

      const id = `turn-${Date.now()}`;
      setBusy(true);
      setMutexMessage(null);
      dispatch({ type: 'new-turn', id, userInput: trimmed });

      let res: Response;
      try {
        res = await fetch('/api/turn', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slug, input: trimmed }),
        });
      } catch (err) {
        dispatch({
          type: 'event',
          id,
          ev: {
            type: 'error',
            message: err instanceof Error ? err.message : 'network error',
            recoverable: true,
          },
        });
        setBusy(false);
        return;
      }

      if (!res.ok || res.body === null) {
        dispatch({
          type: 'event',
          id,
          ev: {
            type: 'error',
            message: `server returned ${res.status}`,
            recoverable: true,
          },
        });
        setBusy(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const { events, rest } = parseSseChunks(buf);
          buf = rest;
          for (const ev of events) {
            dispatch({ type: 'event', id, ev });
            if (ev.type === 'error' && ev.recoverable && ev.message === 'still working') {
              setMutexMessage(
                'A turn is already running for this campaign. Try again once it completes.',
              );
            }
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, slug],
  );

  return (
    <div className="mx-auto flex h-screen w-full max-w-7xl flex-col gap-4 p-4 lg:flex-row">
      <div className="flex flex-1 flex-col">
        <h1 className="mb-2 font-semibold text-2xl">{slug}</h1>
        <MutexBanner visible={mutexMessage !== null} message={mutexMessage ?? ''} />
        <Conversation>
          <ConversationContent>
            {turns.length === 0 && (
              <ConversationEmptyState
                title="Begin the session"
                description="Describe what your character does next."
              />
            )}
            {turns.map((t) => (
              <TurnView key={t.id} slug={slug} turn={t} />
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
        <PromptInput
          onSubmit={async (msg) => {
            const text = msg.text ?? '';
            await submit(text);
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea
              ref={inputRef}
              placeholder="What do you do?"
              disabled={busy || mutexMessage !== null}
            />
            <PromptInputToolbar>
              <PromptInputSubmit
                disabled={busy || mutexMessage !== null}
                status={busy ? 'streaming' : 'ready'}
              />
            </PromptInputToolbar>
          </PromptInputBody>
        </PromptInput>
      </div>
      <aside className="w-full shrink-0 lg:w-80">
        {turns.length > 0 && <PhaseTape phases={turns[turns.length - 1].state.phases} />}
      </aside>
    </div>
  );
}

function TurnView({ slug, turn }: { slug: string; turn: TurnRecord }) {
  const { state } = turn;
  const proseToRender = state.finalProse ?? state.prose;
  return (
    <div className="flex flex-col gap-3">
      <Message from="user">
        <MessageContent>
          <span>{turn.userInput}</span>
        </MessageContent>
      </Message>
      {(state.status !== 'idle' || proseToRender.length > 0) && (
        <Message from="assistant">
          <MessageContent>
            <MessageResponse>{proseToRender}</MessageResponse>
          </MessageContent>
        </Message>
      )}
      {state.error && (
        <Message from="assistant">
          <MessageContent>
            <span className="text-destructive text-sm">
              Error: {state.error.message}
              {state.error.recoverable ? '' : ' (not recoverable)'}
            </span>
          </MessageContent>
        </Message>
      )}
      {state.status === 'done' && state.audioPath && (
        <AudioPlayer className="mt-2">
          <AudioPlayerElement
            src={`/api/turn/audio?slug=${encodeURIComponent(slug)}&filename=${encodeURIComponent(basename(state.audioPath))}`}
          />
          <AudioPlayerControlBar>
            <AudioPlayerPlayButton />
            <AudioPlayerTimeDisplay />
            <AudioPlayerTimeRange />
            <AudioPlayerDurationDisplay />
            <AudioPlayerMuteButton />
            <AudioPlayerVolumeRange />
          </AudioPlayerControlBar>
        </AudioPlayer>
      )}
      {state.status === 'done' && state.images.length > 0 && (
        <TurnImages slug={slug} images={state.images} />
      )}
    </div>
  );
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}
```

- [ ] **Step 3: Verify the build.**

```bash
pnpm build
```

Expected: succeeds. Common failure modes + fixes:

- **`AudioPlayer*` / `PromptInput*` named-export mismatch.** Open the offending component file in `src/components/ai-elements/` and adjust the imports to whatever names exist (the names in this plan match the files inspected at planning time; if a downstream codemod renamed them, take the rename).
- **`MessageResponse` doesn't accept `children` as a string.** It's `Streamdown`-based; passing a string is the documented form. If the type complains, pass `{proseToRender}` as a child via `<MessageResponse>{proseToRender}</MessageResponse>` (already done above).
- **`PromptInputSubmit` `status` prop type mismatch.** Inspect `src/components/ai-elements/prompt-input.tsx` for the expected union and pick the matching string (the variant set is small — `ready` / `streaming` / `error` typically).

- [ ] **Step 4: Local manual smoke (mock mode).**

```bash
# In one terminal:
RPG_RUNNER_MOCK=1 pnpm dev
# Open http://localhost:3000/play/commodore-vex
# Type "test" + submit. Phases should tick through; prose streams; on
# `done` the audio player shows (404s on the audio file because the mock
# emits a fake path — that's expected); no images grid (mock emits [])
```

Expected: the UI exercises every state transition. The audio 404 is intentional and goes away in live mode.

- [ ] **Step 5: Commit.**

```bash
git add src/app/play/[slug]/page.tsx src/app/play/[slug]/play-client.tsx
git commit -m "wave-6(ui): /play/[slug] chat — SSE consumer, prose stream, phase tape, media"
```

---

## Task 9: Out-of-band cleanup — repurpose `src/app/page.tsx`

**Files:**

- Modify: `src/app/page.tsx`

The create-next-app default landing is dead. The spec's out-of-band cleanup section (lines 601–605) calls it out: "delete or repurpose". Repurpose: redirect to `/play/<VAULT_SLUG>` if the env is set, otherwise show a tiny fallback.

We do **not** touch `src/app/chat/page.tsx` or `src/app/api/chat/route.ts` in this wave — see the "What's already on disk" preamble for why.

- [ ] **Step 1: Replace `src/app/page.tsx`.**

```tsx
// src/app/page.tsx
//
// Root landing — redirects to the configured campaign's play page if
// VAULT_SLUG is set, otherwise renders a one-line "no campaign configured"
// fallback. Replaces the create-next-app default. Per the spec's
// "Out-of-band cleanup" section (lines 601-605).

import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function Home() {
  const slug = process.env.VAULT_SLUG;
  if (slug && slug.trim().length > 0) {
    redirect(`/play/${encodeURIComponent(slug)}`);
  }
  return (
    <main className="flex h-screen w-full flex-col items-center justify-center gap-3 p-8">
      <h1 className="font-semibold text-2xl">mastra-rpg</h1>
      <p className="text-muted-foreground text-sm">
        No campaign configured. Set <code>VAULT_SLUG</code> in <code>.env.local</code> and reload.
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Verify the build still passes.**

```bash
pnpm build
```

Expected: succeeds.

- [ ] **Step 3: Commit.**

```bash
git add src/app/page.tsx
git commit -m "wave-6(cleanup): replace create-next-app landing with /play redirect"
```

---

## Task 10: Manual browser smoke + exit-criteria verification

This task is the spec-mandated manual smoke test (Wave-6 exit criteria, lines 593–598). It does not produce committable artifacts; it is a checklist for the engineer to run before declaring the wave done.

Two modes: **mock-only** (works without Wave 5) and **live** (requires Wave 5 merged, or its `liveRunTurn` filled in).

### Mock mode (always available)

- [ ] **Step 1: Start the dev server in mock mode.**

```bash
RPG_RUNNER_MOCK=1 pnpm dev
```

Wait for "Ready in ..." in the log.

- [ ] **Step 2: Open `localhost:3000` and verify the redirect.**

Set `VAULT_SLUG=commodore-vex` in `.env.local` first. Open `http://localhost:3000`. Expected: redirected to `/play/commodore-vex`. The page renders with the empty-state message and an enabled input.

- [ ] **Step 3: Submit a turn.**

Type `I confront the harbormaster.` and submit. Expected within ~2 seconds:

- Phase tape on the right appears with `Factions (2)` → done, `Narrator` → active.
- Narrator prose appears in the main column, chunk by chunk.
- After the last prose delta, `Audio + images` → done, `Persisting turn` → done.
- Audio player widget appears (the file 404s — that's expected in mock mode).

- [ ] **Step 4: Verify SSE disconnect does not abort the workflow (invariant #3).**

Submit another turn. Mid-stream, **close the browser tab**. Re-open `localhost:3000/play/commodore-vex`. Check the dev server logs: the mock runner should have logged a `done` event after the disconnect (the mock prints nothing by default — for this smoke, add a temporary `console.log('mock done')` at the end of `mockRunTurn` for the duration of the smoke; remove before committing if you accidentally staged it).

- [ ] **Step 5: Verify mutex contention surfaces a banner.**

The mock doesn't simulate the mutex by default. Temporarily edit `src/lib/sse/runner.ts` to force `failure: 'mutex'` and reload. Expected: `MutexBanner` appears at the top of the page, the input is disabled. Revert the edit when done.

### Live mode (requires Wave 5)

- [ ] **Step 6: Confirm Wave 5 is merged.**

```bash
test -f src/mastra/workflows/turn.ts && grep -q "turnWorkflow" src/mastra/index.ts && echo W5_OK
```

If not `W5_OK`, stop. Live-mode smoke is gated on Wave 5; if Wave 6 ships first, this section is a follow-up after the merge.

- [ ] **Step 7: Drop the mock flag and run dev.**

```bash
pnpm dev
```

`RPG_RUNNER_MOCK` should be unset.

- [ ] **Step 8: Submit a real turn at `/play/commodore-vex`.**

Verify:

- Phase tape shows real phase counts (factions = number of on-stage faction NPCs).
- Prose streams from the real narrator.
- On `done`, the audio player plays the real `.ogg`.
- Image grid renders any illustrator images via `/api/turn/image`.
- Inspect the vault on disk: `vaults/commodore-vex/journal.md` has a new `## turn-NNN` block; `vaults/commodore-vex/audio/narrator-turn-NNN.ogg` exists; `vaults/commodore-vex/playtests/YYYY-MM-DD.md` has a new turn summary.

### Exit-criteria checklist (spec lines 593–598)

- [ ] Browser at `localhost:3000/play/commodore-vex` plays a full turn end-to-end. *(Step 8 above in live mode; Step 3 in mock mode.)*
- [ ] Phase tape updates on each `phase` event; prose streams via `prose_delta`; audio + images appear at `done`. *(Step 3.)*
- [ ] SSE disconnect mid-stream does NOT abort the workflow; on page reload, the journal shows the completed turn. *(Step 4 in mock; Step 8 in live — inspect `journal.md` to confirm.)*
- [ ] Mutex contention surfaces as `error: "still working"` and disables input until the in-flight turn completes. *(Step 5.)*

---

## Risks and known soft spots

- **UI LOC estimate.** The spec calls this out: the UI is "the softest estimate; with existing components it could land under 200; a richer UX could push past 450." The plan above targets ~250 LOC for `play-client.tsx` plus three ~30 LOC display components, so we land in the 320–360 LOC range. If the engineer extracts the SSE consumer hook (`useSseTurn`) into its own file, that's clean separation but adds a file; leave that decision to PR review.
- **Next 16 App Router SSE quirks.** Returning a `ReadableStream<Uint8Array>` is supported, but `next dev` with Fast Refresh has historically buffered the first chunk. The `x-accel-buffering: no` + flushing-after-each-`controller.enqueue` works around it. If during smoke you see prose arriving in one shot rather than streaming, the symptom is almost always Fast Refresh interfering; reload and re-test, or try `pnpm build && pnpm start`.
- **`PromptInput` prop shape.** The ai-elements primitives evolve quickly; the names used in `play-client.tsx` were the ones present at planning time. If the build fails on an unknown prop, inspect the source file under `src/components/ai-elements/prompt-input.tsx` and adapt — the API surface is small (a textarea + a submit; everything else is optional).
- **`MessageResponse` re-renders.** It's memoized on `children === children` reference equality. Each `prose_delta` creates a new string, which trips the comparison correctly, but if a future micro-optimization caches the string in a ref to avoid that, the message will stop streaming visually. Don't.
- **Heartbeat cadence.** 15s is conservative for localhost-only v0. If proxies/load balancers ever enter the picture (v0.5), revisit — some Cloudflare-like setups want < 10s.
- **`AgentLike<T>` structural compatibility with Mastra's `Agent`.** Wave 5 is merged and the `PhaseEvent` wire contract is locked. The single remaining contract risk is whether Mastra's concrete `Agent` class structurally assigns to Wave 5's `AgentLike<T> = { generate(prompt): Promise<{ object: T }>; stream(prompt): Promise<{ textStream, object }> }`. Wave 5's tests use mocks shaped to `AgentLike`, not the real `Agent`. If TypeScript rejects passing `narratorAgent` (etc.) into `RunTurnDeps`, the mitigation is a ~10-line `adaptMastraAgent<T>(agent): AgentLike<T>` helper inside `runner.ts` that wraps `agent.generate({ prompt, output: Z })` → `{ object }` and `agent.stream(...)` → `{ textStream, object }`. The plan's `liveRunTurn` body has a comment marking the exact line where the adapter would slot in.

---

## Self-review

**Spec coverage:** every Wave-6 exit-criterion line (593–598) maps to a task above. Concurrency invariant #3 has its own route-level test (Task 6 Step 1, third `it`). Phase tape, prose stream, audio, images, mutex banner all have a component or a reducer test. Out-of-band cleanup of `src/app/page.tsx` is Task 9.

**Placeholder scan:** no `TBD`, no "implement later", no untested "appropriate error handling" hand-waves. Every code block is complete and copy-pasteable; every test asserts behavior. The single forward reference is "Wave 5 fills in `liveRunTurn`" — that's a deliberate seam and is documented in-source.

**Type consistency:** `PhaseEvent` is declared once in `events.ts` and imported everywhere. `UiState` and `PhaseRecord` are declared once in `reducer.ts` and re-used in `phase-tape.tsx`. The `ImageMeta` import path (`@/lib/schemas`) is identical in `events.ts`, `reducer.ts`, and `turn-images.tsx`. `Emit` is a single named export from `runner.ts`. Route POST signature is `(req: Request, opts?: PostOpts) => Promise<Response>` — opts is test-only DI, optional, types match the call sites.

**Tests vs production parity:** the `runner` test asserts the canonical sequence; the `route` test exercises the full SSE round-trip via `parseSseChunks`; the `reducer` test covers every event variant. The only thing not covered by automated tests is React rendering, which is intentionally and clearly delegated to the manual browser smoke (Task 10).
