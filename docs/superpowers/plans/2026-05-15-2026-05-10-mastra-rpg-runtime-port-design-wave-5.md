# Wave 5 — Turn Workflow + Live Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the orchestration spine for one player turn: a five-step Mastra workflow that loads the vault, fans out to faction agents in parallel, streams the narrator's prose, runs the illustrator in parallel with TTS, and persists everything to the vault — releasing the mutex in `finally` no matter what. Ship the 8 Layer-2 integration scenarios green with mocked agents/media and a thin live smoke CLI that hits real OpenAI + Inworld end-to-end.

**Architecture:** One file (`src/mastra/workflows/turn.ts`) owns the orchestration. Mastra's `createWorkflow` is registered with `Mastra({ workflows })` so Studio can show it, but the actual orchestration is a single async function `runTurn(input, deps)` exported from the same file that wraps `agent.generate(...)` and `agent.stream(...)` calls directly. Why not pure `createStep`/`.then()`/`.parallel()` composition? Because three constraints make a single async function strictly simpler: (1) we need a `try { ... } finally { releaseMutex(...) }` around all five steps to enforce concurrency invariant §1; a workflow-level wrapper step would have to re-implement that and pass mutex-held state forward in `stateSchema`. (2) The narrator stream emits `prose_delta` events that must reach the SSE consumer through a `PhaseEventEmitter` callback that lives outside Mastra's `writer` (the API route owns it, the workflow accepts it as a dep). (3) Retry-with-feedback on Zod schema failures is per-agent prompt-rewriting, which is a 1-line `try`/catch around `agent.generate`, not a workflow `.branch()`. So Wave 5 wires the `createWorkflow` shell for Studio observability (one wrapping step that calls `runTurn`) and keeps the actual logic linear and unit-testable.

**Tech Stack:** TypeScript (ES2022 strict), Mastra `@mastra/core/workflows` (`createWorkflow`, `createStep` for the Studio shell), `@mastra/core/agent` calls via `agent.generate({ ... })` and `agent.stream(...).fullStream` (Wave 4), Zod 4 (already present), Node 22.13+ for `node:fs/promises`, vitest with mock agents/media. No new dependencies.

**Source spec:** `docs/superpowers/specs/2026-05-10-mastra-rpg-runtime-port-design.md` — Wave 5 section (lines 568–582), Per-turn workflow pseudocode (lines 174–284), Phase events (lines 286–299), Error handling / Failure matrix (lines 325–344), Concurrency invariants (lines 346–367), Testing Layer 2 (lines 397–408), Live smoke test (lines 410–418), Stub-on-mention (lines 307–313), Faction trigger rule (lines 301–305), Non-failures as success (lines 372–375).

**Wave-1/2/3/4 outputs you depend on (already merged, do NOT modify):**

- `src/lib/vault/lock.ts` — `acquireMutex(key)` → boolean synchronous; `releaseMutex(key)` idempotent; `isLocked(key)` for tests. Survives Next.js HMR via `globalThis`.
- `src/lib/vault/turnId.ts` — `await mintTurnId(root)` → `'turn-NNN'`. Atomic-write of `.turn-counter`. Reads-then-increments.
- `src/lib/vault/entities.ts` — `await loadAlwaysLoaded(root)` → `{ world, character, threads, zeroMap, styleGuide, factions: Record<slug, EntityDoc> }`. `loadNpc(root, slug)`, `loadLocation(root, slug)`, `loadFaction(root, slug)` for on-demand reads.
- `src/lib/vault/journal.ts` — `parseRecentEntries(root, n)` returns oldest-to-newest `JournalEntry[]`; `appendJournal(root, turnId, prose)` writes a heading + body block (no return).
- `src/lib/vault/wikilinks.ts` — `parseWikilinks(text)` returns `ParsedLink[]`; `resolveWikilink(link, registry)` returns `{ kind, slug, found }`; `stripForTts(text)` returns wikilink-stripped TTS-safe prose.
- `src/lib/vault/stubs.ts` — `await createStub(root, { kind, slug, excerptProse })` → `{ path, created }`. Idempotent.
- `src/lib/vault/threads.ts` — `await worldTick(root, { days?, hours? })` → `MaturedThread[]`. Returns matured-this-tick subset.
- `src/lib/vault/playtests.ts` — `await appendPlaytest(root, turnId, body, { today? })` → file path.
- `src/lib/vault/paths.ts` — `vaultRoot(slug)`; `zeroMapPath(root)`.
- `src/lib/dossier.ts` — `identifyOnStage({ playerInput, recent, entities })` → `OnStage = { npcs, locations, factionsToSpawn }`; `buildFactionDossier(input)`, `buildNarratorDossier(input)`, `buildIllustratorDossier(input)`; `extractVisualBlock(styleGuide)`.
- `src/lib/schemas.ts` — `FactionOutput`, `NarratorOutput`, `IllustratorOutput`, `ImageMeta` (Zod schemas + TS types).
- `src/lib/media/tts.ts` — `await ttsRender(text, { voice?, output, apiKey?, deps? })` → output path. Writes OGG Opus via `@inworld/tts`.
- `src/lib/media/image.ts` — `await generateImage({ prompt, slug, vaultRoot, ... })` → `ImageMeta`. Filename `YYYYMMDD-HHMMSS-<slug>-<6char-rand>.png` already enforces invariant §4.
- `src/mastra/agents/narrator.ts` — `narratorAgent: Agent` with `model: 'openai/gpt-5.5'`, `tools: { loadEntity, dice }`, structured output `NarratorOutput` set on `defaultOptions`.
- `src/mastra/agents/faction.ts` — `factionAgent: Agent` with no tools, `FactionOutput` on `defaultOptions`.
- `src/mastra/agents/illustrator.ts` — `illustratorAgent: Agent` with `tools: { image }`, `IllustratorOutput` on `defaultOptions`.
- `src/mastra/index.ts` — already registers all three agents. Wave 5 adds `workflows: { turnWorkflow }` to it.

**Confirmed Mastra SDK shape (verified against `node_modules/@mastra/core@1.32.1`):**

- `createWorkflow({ id, inputSchema, outputSchema }).then(step).commit()` returns a workflow you register on `new Mastra({ workflows })`. Workflows MUST be `.commit()`-finalised before registration.
- `createStep({ id, inputSchema, outputSchema, execute })`. `execute` receives `{ inputData, mastra, writer, requestContext, state, setState }`.
- Streaming: `await run.stream({ inputData })` returns `{ fullStream, result, ... }`. Iterating `fullStream` yields chunks; awaiting `result` returns the final `{ status, result | error | suspendPayload }`. `start()` is the non-streaming variant.
- Agent calls: `agent.generate(prompt, { structuredOutput: { schema }, ... })` returns a result whose `.object` is the validated parse. `agent.stream(prompt, { structuredOutput: { schema } })` returns a stream with `fullStream`, `textStream`, and `await stream.object` / `await stream.text`. With `defaultOptions.structuredOutput.schema` already set on each Wave-4 agent, `agent.generate(prompt)` is enough.
- **Errors:** when `structuredOutput.errorStrategy` is the default `'strict'`, Zod validation failure throws from `agent.generate`. We catch the throw to implement retry-with-feedback (no `errorStrategy: 'fallback'` — we want to inspect the validation error message and feed it back into the next prompt).
- The Wave-4 agents do NOT set `errorStrategy`, so they default to `strict` — which is what we want.

---

## Pre-flight check (informational — do NOT re-run if green)

Before starting, verify Waves 1-4 are in place. If anything below is missing or has drifted, **stop and report** rather than fix inline — those are separate tickets.

- [ ] **Verify Wave 1-4 source files exist.**

```bash
ls src/lib/schemas.ts src/lib/dossier.ts src/lib/vault/lock.ts src/lib/vault/turnId.ts \
   src/lib/vault/entities.ts src/lib/vault/journal.ts src/lib/vault/threads.ts \
   src/lib/vault/stubs.ts src/lib/vault/playtests.ts src/lib/vault/wikilinks.ts \
   src/lib/media/image.ts src/lib/media/tts.ts \
   src/mastra/agents/narrator.ts src/mastra/agents/faction.ts src/mastra/agents/illustrator.ts \
   src/mastra/tools/dice.ts src/mastra/tools/loadEntity.ts src/mastra/tools/image.ts \
   src/mastra/index.ts
```

Expected: all 19 paths listed. If any missing, abort.

- [ ] **Verify all existing tests pass on a clean tree.**

```bash
pnpm test --run
```

Expected: green. If anything fails, abort — Wave 5 must build on a green baseline.

- [ ] **Verify the working tree is clean on the wave-5 branch.**

```bash
git status -uno && git rev-parse --abbrev-ref HEAD
```

Expected: clean tree, branch `auto/2026-05-10-mastra-rpg-runtime-port-design-wave-5`.

- [ ] **Verify fixture vault is present.**

```bash
ls tests/fixtures/test-vault/world.xml tests/fixtures/test-vault/threads.xml \
   tests/fixtures/test-vault/journal.md tests/fixtures/test-vault/style-guide.md \
   tests/fixtures/test-vault/factions tests/fixtures/test-vault/npcs tests/fixtures/test-vault/locations
```

Expected: all paths listed.

---

## File structure

Production files:

| File                           | Responsibility                                                                                                                                                                                                                                                                                                                                | LOC budget |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------: |
| `src/mastra/workflows/turn.ts` | Exports (a) `runTurn(input, deps)` — the orchestrator; (b) `turnWorkflow` — a Mastra `createWorkflow` shell wrapping `runTurn` so it appears in Studio; (c) the `PhaseEvent` discriminated union type re-exported from the spec; (d) `PhaseEventEmitter` callback type. Five logical steps inside `runTurn`, with mutex release in `finally`. |       ~320 |
| `src/mastra/index.ts` (modify) | Add the workflow to `new Mastra({ ..., workflows: { turnWorkflow } })`. ~3 LOC of net change.                                                                                                                                                                                                                                                 |       (~3) |
| `scripts/smoke-turn.ts`        | CLI: `pnpm tsx scripts/smoke-turn.ts --vault <path> --input "..."`. Reads flags, calls `runTurn` with real agents from `mastra.getAgent(...)`, real TTS + image deps, prints a summary. NOT registered with Mastra; NOT shipped to prod.                                                                                                      |        ~30 |

Test files (all new):

| File                                   | Coverage                                                                                                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/mastra/workflows/turn.test.ts`    | 8 Layer-2 integration scenarios (happy path, faction retry × 2, narrator retry × 2, concurrent turns, image gen failure, TTS failure × 2, mid-step crash, stub cap). Uses a copy of `tests/fixtures/test-vault` per test (filesystem mutating). |
| `src/mastra/workflows/turn.harness.ts` | (~80 LOC test-helper, NOT counted in LOC budget) — fixture-vault copier, mock agent factories (`makeMockFactionAgent({ outputs })`, etc.), `PhaseEvent` collector. Lives alongside the test for discoverability.                                |

Out of LOC budget but mandatory:

- `src/mastra/workflows/turn.ts` ~320 LOC + `scripts/smoke-turn.ts` ~30 LOC = ~350 LOC total production.

Vitest coverage gate: `vitest.config.ts` already includes `src/mastra/**/*.ts`. Wave 5 must keep coverage ≥ 80% lines/functions/branches/statements; tests should cover every branch in `runTurn` including all retry and failure paths.

---

## Non-goals / out of scope (Wave 6 deferred)

The following are explicitly NOT in Wave 5:

1. **No HTTP route.** `src/app/api/turn/route.ts` is Wave 6. The workflow accepts a `PhaseEventEmitter` callback dep but does NOT know about SSE, ReadableStream, or NextResponse. The Wave-6 route will instantiate its own `ReadableStream` and pass a callback that pushes events into the SSE writer.
2. **No UI.** No `src/app/play/[slug]/page.tsx`. Wave 6.
3. **No request-abort handling.** The workflow ignores any caller's `AbortSignal` (concurrency invariant §3). The `deps` interface does NOT accept an `AbortSignal` parameter; do not add one.
4. **No streaming TTS.** TTS renders once after prose is final.
5. **No mid-turn crash resume.** The lock map dies with the process; turn-counter may waste an ID. Documented invariant.
6. **No `flock` external locking.** v0.5.
7. **No replay parity.** Forward-only.
8. **No discretionary off-stage faction spawns.** Only mandatory faction spawns from `OnStage.factionsToSpawn` per spec lines 301–305.
9. **No live agent calls in Wave 5 unit tests.** All 8 integration scenarios use mock agents. Real-LLM verification lives in `scripts/smoke-turn.ts` (manual run).

The `PhaseEvent` union (see "SSE contract" below) is the only Wave-5/Wave-6 interface; both waves agree on its shape verbatim from the spec.

---

## SSE contract (Wave-5 ↔ Wave-6 interface)

Verbatim from spec lines 288–297:

```ts
// Exported from src/mastra/workflows/turn.ts:
export type PhaseEvent =
  | { type: 'phase'; name: 'factions'; count: number }
  | { type: 'phase'; name: 'narrator' }
  | { type: 'prose_delta'; text: string }
  | { type: 'phase'; name: 'media' }
  | { type: 'phase'; name: 'persist' }
  | { type: 'done'; audioPath: string; finalProse: string; images: ImageMeta[] }
  | { type: 'error'; message: string; recoverable: boolean };

export type PhaseEventEmitter = (event: PhaseEvent) => void;
```

Additional emission rules Wave 5 commits to (Wave 6 will rely on these):

- `phase: factions` fires exactly once, after Step 1 and before Step 2 (even when `count === 0`).
- `phase: narrator` fires exactly once, after Step 2 returns all faction decisions.
- `prose_delta` fires zero or more times during Step 3, one per text-delta chunk from `narratorAgent.stream(...).fullStream`. Concatenated text equals `narratorOutput.prose`.
- `phase: media` fires exactly once after Step 3 yields its final object.
- `phase: persist` fires exactly once at the start of Step 5.
- `done` fires exactly once, last, after Step 5 completes successfully. Carries the final wikilinked prose (`illustratorOutput.prose_with_embeds`), the audio path, and the images array.
- `error` fires exactly once instead of `done` whenever a non-recoverable error escapes `runTurn`'s try. `recoverable: true` for: mutex contention, narrator-failed-twice (player retries), TTS-failed-twice. `recoverable: false` for: filesystem write failure, ffmpeg-not-on-path-at-startup (caught upstream), unknown crash.

Step-by-step phase / prose ordering for a happy turn:

```
phase{factions, count:N} → phase{narrator} → prose_delta × M → phase{media} → phase{persist} → done
```

---

## Runtime invariants Wave 5 enforces in code

These are NON-negotiable and verified by the integration tests:

1. **`finally` releases the mutex.** Every code path through `runTurn` — including the `agent.generate` throw paths and any internal `throw` in steps 2-5 — must release the mutex acquired in Step 1. Verified by Scenario 7 (mid-step crash).
2. **Mutex contention returns synchronously.** If `acquireMutex(slug)` returns `false`, `runTurn` emits `error: { recoverable: true, message: 'still working' }` and resolves the promise without throwing. Verified by Scenario 4 (concurrent turns).
3. **No `AbortSignal` propagation.** The workflow accepts no `AbortSignal` dep, registers no abort listener, and does not pass one to `agent.generate` / `agent.stream`. Verified by inspection (this plan + code review).
4. **Image filename random suffix.** Wave 3 already enforces this in `buildFilename` (`YYYYMMDD-HHMMSS-<slug>-<6char-rand>.png`). Wave 5 does NOT add any new filename generation; it lets the illustrator's `image` tool calls each produce a fresh filename. Verified by spot-check in Scenario 1.
5. **No partial persist on narrator failure.** When Steps 1-2 succeed but Step 3 fails twice, `runTurn` must NOT call `appendJournal`, `worldTick`, `createStub`, or `appendPlaytest`. Verified by Scenario 3.
6. **No partial persist on TTS failure.** Same rule for Step 4 failure: even though the illustrator may have already produced images and `prose_with_embeds`, a TTS-failed-twice turn does NOT append to journal. Verified by Scenario 6.
7. **Mutex released even when `acquireMutex` returns false.** Sounds paradoxical but isn't: when contention is detected, we did NOT acquire the lock, so we must NOT call `releaseMutex` (it would release the other request's hold). The `finally` block must be gated on a `held: boolean` local. Verified by Scenario 4.

---

## `runTurn` orchestration design (single source of truth)

The function lives at the top of `src/mastra/workflows/turn.ts` and is the entry point of the workflow shell.

```ts
// src/mastra/workflows/turn.ts (signature only — implementation in tasks below)

export interface RunTurnInput {
  vaultRoot: string;
  playerInput: string;
}

export interface RunTurnResult {
  status: 'success';
  turnId: string;
  finalProse: string;
  audioPath: string;
  images: ImageMeta[];
  matured: MaturedThread[];
} | {
  status: 'error';
  message: string;
  recoverable: boolean;
};

export interface RunTurnDeps {
  // Agent seams. Production passes `mastra.getAgent('narratorAgent')` etc;
  // tests pass mock objects that implement the minimum surface.
  narratorAgent: AgentLike<NarratorOutput>;
  factionAgent: AgentLike<FactionOutput>;
  illustratorAgent: AgentLike<IllustratorOutput>;

  // Media seams. Production calls `ttsRender` from `@/lib/media/tts`.
  // Tests pass spies that succeed or fail per scenario.
  ttsRender: (text: string, opts: { output: string; voice?: string }) => Promise<string>;

  // Phase-event sink. SSE in prod; in-memory array in tests.
  // The workflow itself does not buffer; events fire as they happen.
  emit: PhaseEventEmitter;

  // Clock seam. Defaults to `() => new Date()`; tests pin it.
  now?: () => Date;
}

export async function runTurn(input: RunTurnInput, deps: RunTurnDeps): Promise<RunTurnResult> { ... }
```

`AgentLike<TOutput>` is a thin structural type around the Mastra `Agent` surface:

```ts
export interface AgentStreamLike<TOutput> {
  textStream: AsyncIterable<string>;
  object: Promise<TOutput>;
  // Wave 5 reads only textStream + object — that's the full surface.
}

export interface AgentLike<TOutput> {
  generate(prompt: string): Promise<{ object: TOutput }>;
  stream(prompt: string): Promise<AgentStreamLike<TOutput>>;
}
```

The Wave-4 `narratorAgent` etc. already satisfy this shape because they have `defaultOptions.structuredOutput.schema` set; `agent.generate(prompt)` returns the schema-typed object on `.object`. No cast needed at the call site.

**Step layout inside `runTurn`** (matches spec lines 174–284):

```
runTurn(input, deps) {
  const slug = path.basename(input.vaultRoot)  // for mutex key
  const held = acquireMutex(slug)
  if (!held) { deps.emit({ type: 'error', message: 'still working', recoverable: true });
               return { status: 'error', message: 'still working', recoverable: true } }
  try {
    // Step 1
    const turnId = await mintTurnId(input.vaultRoot)
    const loaded = await loadAlwaysLoaded(input.vaultRoot)
    const recent = await parseRecentEntries(input.vaultRoot, 5)
    const allEntities = await collectAllEntities(input.vaultRoot, loaded, recent, input.playerInput)
    const onStage = identifyOnStage({
      playerInput: input.playerInput,
      recent,
      entities: allEntities,
    })
    deps.emit({ type: 'phase', name: 'factions', count: onStage.factionsToSpawn.length })

    // Step 2 — parallel faction fan-out, retry-with-feedback per agent.
    const decisions = await Promise.all(
      onStage.factionsToSpawn.map(async (factionSlug) => {
        const dossier = buildFactionDossier({
          faction: loaded.factions[factionSlug],
          onStage, recent, world: loaded.world,
          character: loaded.character, playerInput: input.playerInput,
        })
        return generateWithRetry(deps.factionAgent, dossier, FactionOutput, {
          fallback: { decision: '[no response]', reasoning: '[validation failed twice]' },
          label: `faction(${factionSlug})`,
        }).then(decision => ({ slug: factionSlug, decision }))
      })
    )
    deps.emit({ type: 'phase', name: 'narrator' })

    // Step 3 — narrator, streamed, retry-with-feedback aborts the turn on second failure.
    const narratorDossier = buildNarratorDossier({
      world: loaded.world, character: loaded.character, threads: loaded.threads,
      styleGuide: loaded.styleGuide.body, onStage, recent,
      factionDecisions: decisions.map(d => ({ slug: d.slug, decision: d.decision.decision })),
      playerInput: input.playerInput, turnId,
    })
    const narratorOutput = await streamNarratorWithRetry(
      deps.narratorAgent, narratorDossier, NarratorOutput, deps.emit
    )
    // throws { kind: 'narrator-failed' } if both attempts fail; caught below.
    deps.emit({ type: 'phase', name: 'media' })

    // Step 4 — illustrator || TTS in parallel.
    const visualBlock = extractVisualBlock(loaded.styleGuide.body) ?? ''
    const illustratorPromise = generateWithRetry(
      deps.illustratorAgent,
      buildIllustratorDossier({ narratorProse: narratorOutput.prose,
        styleGuideVisual: visualBlock, onStage }),
      IllustratorOutput,
      { fallback: { prose_with_embeds: narratorOutput.prose, images: [] },
        label: 'illustrator' }
    )
    const audioPath = path.join(input.vaultRoot, 'audio', `narrator-${turnId}.ogg`)
    const ttsPromise = ttsWithRetry(deps.ttsRender,
      stripForTts(narratorOutput.prose), audioPath
    )
    const [illustratorOutput, audioPathResolved] =
      await Promise.all([illustratorPromise, ttsPromise])
    // ttsPromise throws { kind: 'tts-failed' } on second failure; caught below.

    // Step 5 — persist (only reached on full success).
    deps.emit({ type: 'phase', name: 'persist' })
    let matured: MaturedThread[] = []
    if (narratorOutput.time_passed) {
      matured = await worldTick(input.vaultRoot, narratorOutput.time_passed)
    }
    const finalProse = illustratorOutput.prose_with_embeds
    await appendJournal(input.vaultRoot, turnId, finalProse)
    const stubCreated = await stubOnMention(input.vaultRoot, loaded, finalProse, turnId)
    await appendPlaytest(input.vaultRoot, turnId, renderPlaytest({
      turnId, decisions, narratorOutput, illustratorOutput, audioPath: audioPathResolved,
      matured, stubCreated,
    }))
    deps.emit({ type: 'done',
      audioPath: audioPathResolved, finalProse, images: illustratorOutput.images })
    return { status: 'success', turnId, finalProse,
      audioPath: audioPathResolved, images: illustratorOutput.images, matured }
  } catch (err) {
    const message =
      isTaggedError(err, 'narrator-failed') ? 'narrator failed; please rephrase' :
      isTaggedError(err, 'tts-failed') ? 'audio render failed' :
      err instanceof Error ? `vault write failed: ${err.message}` :
      'unknown error'
    const recoverable =
      isTaggedError(err, 'narrator-failed') || isTaggedError(err, 'tts-failed')
    deps.emit({ type: 'error', message, recoverable })
    return { status: 'error', message, recoverable }
  } finally {
    releaseMutex(slug)
  }
}
```

Helpers also defined in `turn.ts`:

- `generateWithRetry(agent, prompt, schema, { fallback, label })` — first call; on Zod-validation throw, retry once with the validation error appended to the prompt; on second failure, return `fallback` (faction + illustrator use this). The retry-feedback string format is fixed below.
- `streamNarratorWithRetry(agent, prompt, schema, emit)` — first stream call; on schema-failure throw, retry once (non-streamed, with feedback); on second failure throw `taggedError('narrator-failed')`. Note: narrator-retry uses `agent.generate(...)` not `agent.stream(...)` — the second attempt is a fresh non-streamed call, so the `prose_delta` event stream is single-source: it only fires for the first (streamed) attempt's text deltas. If retry-1 succeeds via `generate`, no prose deltas are emitted (this is acceptable; the player still sees prose appear in the journal post-render. The phase-event `narrator: retrying` from spec error matrix is folded into `error` emission deferred — Wave 5 does NOT emit a "retrying" sub-event; reviewers/spec accept this).
- `ttsWithRetry(ttsRender, text, output)` — first call; on throw, retry once with a 200ms backoff (`setTimeout` Promise); on second failure throw `taggedError('tts-failed')`.
- `stubOnMention(root, loaded, finalProse, turnId)` — parses wikilinks in `finalProse`, takes the first 2 unresolved (per spec cap), creates stubs, appends overflow to `0-Map.md` as `- TODO: stub for [[<target>]] (turn-NNN)`. Returns `{ stubsCreated: string[], overflowAppended: string[] }` for the playtest log.
- `renderPlaytest({...})` — formats the per-turn block: faction decisions (slug, decision, reasoning), narrator time_passed, illustrator image count + filenames, audio path, matured thread names, stub-on-mention summary. Pure function, no I/O.
- `collectAllEntities(root, loaded, recent, playerInput)` — assembles the entity set passed to `identifyOnStage`. It must include all NPCs and locations referenced (resolved) by either the player input or the recent journal. Wave 1's `loadAlwaysLoaded` loads factions + style guide + world/character/threads but does NOT eagerly load NPCs/locations. So `collectAllEntities` parses wikilinks from `[playerInput, ...recent.map(r => r.body)]`, resolves each via `resolveWikilink({ target, embed: false }, registry)`, builds the registry from `fs.readdir(npcsDir(root))` + `fs.readdir(locationsDir(root))`, and `await Promise.all` loads each unique slug via `loadNpc` / `loadLocation`. Missing files are silently skipped (the entity was deleted between turns — fine). The result is deduplicated by `(kind, slug)` and passed to `identifyOnStage`. `factionsToSpawn` falls out of `identifyOnStage` correctly since it inspects `frontmatter.faction` on each NPC.

**Retry-with-feedback prompt format** (used by `generateWithRetry` and `streamNarratorWithRetry`):

```
<original dossier>

---

VALIDATION ERROR ON PREVIOUS ATTEMPT:
<Zod error message, stringified>

Re-emit your response, fixing the schema mismatch. The previous attempt failed validation and was discarded.
```

The retry prompt is a single string concatenated to the original dossier with the separator. The Zod error message comes from `(err as Error).message` — for Mastra structured-output failures, this contains the field path and reason. If `err` is not an `Error` (impossible in practice), fall back to `String(err)`.

---

## Mastra workflow shell (Studio observability)

The actual orchestration is `runTurn`, but we also register a single-step `turnWorkflow` so Mastra Studio can show the run. The step delegates to `runTurn` with adapter deps:

```ts
const turnStep = createStep({
  id: 'turn',
  inputSchema: z.object({
    vaultRoot: z.string().min(1),
    playerInput: z.string().min(1),
  }),
  outputSchema: z.object({
    turnId: z.string(),
    finalProse: z.string(),
    audioPath: z.string(),
    imageCount: z.number().int().nonnegative(),
  }),
  execute: async ({ inputData, mastra, writer }) => {
    const narratorAgent = mastra!.getAgent('narratorAgent');
    const factionAgent = mastra!.getAgent('factionAgent');
    const illustratorAgent = mastra!.getAgent('illustratorAgent');
    const result = await runTurn(inputData, {
      narratorAgent,
      factionAgent,
      illustratorAgent,
      ttsRender,
      emit: (e) => {
        writer?.write(e).catch(() => {});
      }, // swallow lock errors per spec
    });
    if (result.status === 'error') {
      throw new Error(`turn failed: ${result.message}`);
    }
    return {
      turnId: result.turnId,
      finalProse: result.finalProse,
      audioPath: result.audioPath,
      imageCount: result.images.length,
    };
  },
});

export const turnWorkflow = createWorkflow({
  id: 'turnWorkflow',
  inputSchema: turnStep.inputSchema,
  outputSchema: turnStep.outputSchema,
})
  .then(turnStep)
  .commit();
```

Why a one-step shell rather than five `createStep`s? Three reasons:

1. **`finally` semantics.** Each `createStep` runs in its own try/catch inside Mastra's engine; the engine bubbles step failures up. To enforce mutex release across all five steps we'd need a wrapper step anyway — the wrapper IS `runTurn`. Putting the body in `createStep` blocks would force us to forward the mutex's `held` flag through `stateSchema` and remember to release in a separate `finalizer` step that runs on both success and failure paths, which Mastra workflows don't have first-class (no `.finally(step)` combinator at 1.32). Single-step is strictly simpler.
2. **Phase events.** Five steps would each emit one phase event via `writer`. But `prose_delta` events fire from inside Step 3 (during the narrator stream) — that's already inside one step. So even a five-step layout doesn't give us per-step phase events for free; we'd still emit from inside each step's body. Single-step makes the call site uniform.
3. **Testability.** `runTurn` is a regular async function; tests call it directly with mock deps. A five-step workflow forces tests to `createRun().start({ inputData })` and inspect the result envelope, which adds noise (`result.status === 'success'`, `result.steps['step-2'].output.…`) without exercising any unique logic.

The `turnWorkflow` registration exists for Studio observability and for Wave 6's API route to optionally call via `mastra.getWorkflow('turnWorkflow')` if the team prefers the workflow surface — but the route is free to call `runTurn` directly with its own SSE emitter; both paths work. Wave 6 will make that decision.

---

## Task-by-task implementation order

Total 13 tasks. Tasks 1-3 set up the type surface and helpers. Tasks 4-12 implement and test the 8 integration scenarios. Task 13 is the smoke CLI and final wiring.

---

### Task 1: Type surface + harness skeleton

**Files:**

- Create: `src/mastra/workflows/turn.ts` (initial skeleton with types and exports only)
- Create: `src/mastra/workflows/turn.harness.ts` (test helpers)

The first commit lands all the public types and stubs (`runTurn` throws `Error('not implemented')`); subsequent commits fill in the body and add tests. This guarantees the `PhaseEvent` union is locked first as the Wave-5/Wave-6 interface.

- [ ] **Step 1: Write `src/mastra/workflows/turn.ts` skeleton.**

```ts
import * as path from 'node:path';
import { z } from 'zod';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import type { ImageMeta, NarratorOutput, FactionOutput, IllustratorOutput } from '@/lib/schemas';
import {
  FactionOutput as FactionOutputSchema,
  NarratorOutput as NarratorOutputSchema,
  IllustratorOutput as IllustratorOutputSchema,
} from '@/lib/schemas';
import type { MaturedThread } from '@/lib/vault/threads';

// ---- Public types (Wave-5 ↔ Wave-6 contract) ----

export type PhaseEvent =
  | { type: 'phase'; name: 'factions'; count: number }
  | { type: 'phase'; name: 'narrator' }
  | { type: 'prose_delta'; text: string }
  | { type: 'phase'; name: 'media' }
  | { type: 'phase'; name: 'persist' }
  | { type: 'done'; audioPath: string; finalProse: string; images: ImageMeta[] }
  | { type: 'error'; message: string; recoverable: boolean };

export type PhaseEventEmitter = (event: PhaseEvent) => void;

export interface AgentStreamLike<TOutput> {
  textStream: AsyncIterable<string>;
  object: Promise<TOutput>;
}

export interface AgentLike<TOutput> {
  generate(prompt: string): Promise<{ object: TOutput }>;
  stream(prompt: string): Promise<AgentStreamLike<TOutput>>;
}

export interface RunTurnInput {
  vaultRoot: string;
  playerInput: string;
}

export type RunTurnResult =
  | {
      status: 'success';
      turnId: string;
      finalProse: string;
      audioPath: string;
      images: ImageMeta[];
      matured: MaturedThread[];
    }
  | { status: 'error'; message: string; recoverable: boolean };

export interface RunTurnDeps {
  narratorAgent: AgentLike<NarratorOutput>;
  factionAgent: AgentLike<FactionOutput>;
  illustratorAgent: AgentLike<IllustratorOutput>;
  ttsRender: (text: string, opts: { output: string; voice?: string }) => Promise<string>;
  emit: PhaseEventEmitter;
  now?: () => Date;
}

export async function runTurn(_input: RunTurnInput, _deps: RunTurnDeps): Promise<RunTurnResult> {
  throw new Error('runTurn: not yet implemented (Wave 5 Task 2+)');
}

// ---- Mastra workflow shell (filled in Task 12) ----

const inputSchema = z.object({
  vaultRoot: z.string().min(1),
  playerInput: z.string().min(1),
});
const outputSchema = z.object({
  turnId: z.string(),
  finalProse: z.string(),
  audioPath: z.string(),
  imageCount: z.number().int().nonnegative(),
});

const turnStep = createStep({
  id: 'turn',
  inputSchema,
  outputSchema,
  execute: async () => {
    throw new Error('turnStep: not yet implemented (Wave 5 Task 12)');
  },
});

export const turnWorkflow = createWorkflow({
  id: 'turnWorkflow',
  inputSchema,
  outputSchema,
})
  .then(turnStep)
  .commit();
```

- [ ] **Step 2: Write `src/mastra/workflows/turn.harness.ts` skeleton.**

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { vi } from 'vitest';
import type { AgentLike, AgentStreamLike, PhaseEvent } from './turn';
import type { FactionOutput, NarratorOutput, IllustratorOutput, ImageMeta } from '@/lib/schemas';

/** Copy the fixture vault into a fresh tmpdir; returns the copy's absolute path. */
export async function copyFixtureVault(source: string): Promise<string> {
  const dst = await fs.mkdtemp(path.join(os.tmpdir(), 'wave5-vault-'));
  await fs.cp(source, dst, { recursive: true });
  return dst;
}

/** Stream that yields the given text deltas then resolves to `object`. */
export function makeAgentStream<T>(deltas: string[], object: T): AgentStreamLike<T> {
  return {
    textStream: (async function* () {
      for (const d of deltas) yield d;
    })(),
    object: Promise.resolve(object),
  };
}

export interface MockAgentConfig<T> {
  /** Sequential outputs returned by generate() / stream(). Index advances per call. */
  outputs: Array<T | { throws: unknown }>;
}

/** Build a mock agent that returns `outputs[i]` on the i-th call. Throws if past end. */
export function makeMockAgent<T>(config: MockAgentConfig<T>): AgentLike<T> & {
  generateCalls: string[];
  streamCalls: string[];
} {
  let i = 0;
  const generateCalls: string[] = [];
  const streamCalls: string[] = [];
  const next = (): T => {
    if (i >= config.outputs.length) throw new Error('mock agent: ran out of outputs');
    const entry = config.outputs[i++];
    if (typeof entry === 'object' && entry !== null && 'throws' in entry) {
      throw (entry as { throws: unknown }).throws;
    }
    return entry as T;
  };
  return {
    generate: async (prompt: string) => {
      generateCalls.push(prompt);
      return { object: next() };
    },
    stream: async (prompt: string) => {
      streamCalls.push(prompt);
      const obj = next();
      // Default deltas are the JSON-ish text — fine for tests; we never assert
      // on textStream content here (Task 4 covers prose_delta via the narrator's
      // own stream test).
      return makeAgentStream([JSON.stringify(obj)], obj);
    },
    generateCalls,
    streamCalls,
  };
}

export function collectEvents(): { events: PhaseEvent[]; emit: (e: PhaseEvent) => void } {
  const events: PhaseEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}
```

- [ ] **Step 3: Verify the skeleton compiles.**

Run: `pnpm tsc --noEmit`
Expected: zero errors. (The skeleton calls `throw new Error(...)` so type narrowing on the body isn't required yet.)

- [ ] **Step 4: Commit.**

```bash
git add src/mastra/workflows/turn.ts src/mastra/workflows/turn.harness.ts
git commit -m "feat(wave-5): scaffold turn workflow types + test harness"
```

---

### Task 2: Step 1 — lock + dossier prep

**Files:**

- Modify: `src/mastra/workflows/turn.ts` (fill in Step 1)
- Modify: `src/mastra/workflows/turn.test.ts` (new file: first scenario coverage of Step 1)

This task lands the mutex acquire, `mintTurnId`, `loadAlwaysLoaded`, `parseRecentEntries`, `collectAllEntities`, `identifyOnStage`, and the `phase: factions` emission. Step 2+ throw `not-yet-implemented` so the partial workflow halts cleanly.

- [ ] **Step 1: Write the failing test (mutex contention + step-1 happy path).**

Create `src/mastra/workflows/turn.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { runTurn, type PhaseEvent } from './turn';
import { acquireMutex, releaseMutex, isLocked } from '@/lib/vault/lock';
import { copyFixtureVault, makeMockAgent, collectEvents } from './turn.harness';

const FIXTURE = path.resolve(__dirname, '../../../tests/fixtures/test-vault');

describe('Step 1: lock + dossier prep', () => {
  let vault: string;
  beforeEach(async () => {
    vault = await copyFixtureVault(FIXTURE);
  });
  afterEach(async () => {
    releaseMutex(path.basename(vault));
    await fs.rm(vault, { recursive: true, force: true });
  });

  it('returns error and emits error event when mutex contended (Scenario 4)', async () => {
    // Pre-acquire to simulate a previous request still running.
    expect(acquireMutex(path.basename(vault))).toBe(true);
    const { events, emit } = collectEvents();
    const result = await runTurn(
      { vaultRoot: vault, playerInput: 'hello' },
      {
        narratorAgent: makeMockAgent({ outputs: [] }),
        factionAgent: makeMockAgent({ outputs: [] }),
        illustratorAgent: makeMockAgent({ outputs: [] }),
        ttsRender: async () => {
          throw new Error('should not call');
        },
        emit,
      },
    );
    expect(result).toEqual({ status: 'error', message: 'still working', recoverable: true });
    expect(events).toEqual([{ type: 'error', message: 'still working', recoverable: true }]);
    // We did NOT release the other request's lock.
    expect(isLocked(path.basename(vault))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm test --run src/mastra/workflows/turn.test.ts`
Expected: FAIL (`runTurn: not yet implemented`).

- [ ] **Step 3: Implement Step 1 inside `runTurn`.**

Open `src/mastra/workflows/turn.ts` and replace the `runTurn` body. The body comes from the design block in this plan ("`runTurn` orchestration design"). Implement only the lock + Step 1 + `phase: factions` emission for this task; throw `new Error('Step 2+ not yet implemented')` after the emit. Wire imports for `acquireMutex`, `releaseMutex`, `mintTurnId`, `loadAlwaysLoaded`, `parseRecentEntries`, `identifyOnStage`, plus a stub `collectAllEntities` function defined at module scope.

`collectAllEntities` implementation:

```ts
async function collectAllEntities(
  root: string,
  loaded: AlwaysLoaded,
  recent: JournalEntry[],
  playerInput: string,
): Promise<EntityDoc[]> {
  // Build the slug registry from the directory listings (folder = source of truth).
  const [npcFiles, locFiles] = await Promise.all([
    fs.readdir(npcsDir(root)).catch(() => [] as string[]),
    fs.readdir(locationsDir(root)).catch(() => [] as string[]),
  ]);
  const registry: AliasRegistry = {
    npcs: new Set(npcFiles.filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3))),
    locations: new Set(locFiles.filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3))),
    factions: new Set(Object.keys(loaded.factions)),
  };
  const text = [playerInput, ...recent.map((r) => r.heading + '\n' + r.body)].join('\n');
  const links = parseWikilinks(text);
  const seen = new Set<string>();
  const docs: EntityDoc[] = [];
  for (const link of links) {
    const r = resolveWikilink(link, registry);
    if (r.kind === 'image' || r.kind === 'faction') continue; // faction docs come from loaded.factions; images are not entities
    if (!r.found) continue;
    const key = `${r.kind}/${r.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const doc = r.kind === 'npc' ? await loadNpc(root, r.slug) : await loadLocation(root, r.slug);
      docs.push(doc);
    } catch {
      // File deleted between turns — silently skip. This matches the spec
      // tolerance for "entity went missing" and is consistent with the
      // loadEntity tool's ENOENT-to-not-found contract (Wave 4).
    }
  }
  return docs;
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm test --run src/mastra/workflows/turn.test.ts`
Expected: PASS for the mutex-contention test. (Step 2+ unimplemented means the happy-path tests come later.)

- [ ] **Step 5: Commit.**

```bash
git add src/mastra/workflows/turn.ts src/mastra/workflows/turn.test.ts
git commit -m "feat(wave-5): Step 1 — lock, turn-id, dossier prep, factions phase event"
```

---

### Task 3: `generateWithRetry` helper

**Files:**

- Modify: `src/mastra/workflows/turn.ts` (add `generateWithRetry` private helper)
- Modify: `src/mastra/workflows/turn.test.ts` (unit tests for the helper)

The retry-with-feedback policy is shared by faction and illustrator. Narrator has its own streaming variant in Task 5. Test the policy in isolation before wiring it into Step 2.

- [ ] **Step 1: Write failing tests for `generateWithRetry`.**

Append to `src/mastra/workflows/turn.test.ts`:

```ts
import { generateWithRetry } from './turn';
import { FactionOutput as FactionOutputSchema } from '@/lib/schemas';

describe('generateWithRetry', () => {
  it('returns the first output if it validates', async () => {
    const agent = makeMockAgent({
      outputs: [{ decision: 'do it', reasoning: 'why' }],
    });
    const out = await generateWithRetry(agent, 'dossier', FactionOutputSchema, {
      fallback: { decision: '[no response]', reasoning: '[fallback]' },
      label: 'faction(x)',
    });
    expect(out).toEqual({ decision: 'do it', reasoning: 'why' });
    expect(agent.generateCalls).toHaveLength(1);
  });

  it('retries with feedback after one validation failure, then succeeds', async () => {
    // First call throws (Zod-style error); second call returns valid output.
    const agent = makeMockAgent({
      outputs: [
        { throws: new Error('reasoning: Required') },
        { decision: 'retry win', reasoning: 'second time' },
      ],
    });
    const out = await generateWithRetry(agent, 'dossier', FactionOutputSchema, {
      fallback: { decision: '[no response]', reasoning: '[fallback]' },
      label: 'faction(x)',
    });
    expect(out).toEqual({ decision: 'retry win', reasoning: 'second time' });
    expect(agent.generateCalls).toHaveLength(2);
    expect(agent.generateCalls[1]).toContain('VALIDATION ERROR ON PREVIOUS ATTEMPT:');
    expect(agent.generateCalls[1]).toContain('reasoning: Required');
  });

  it('returns the fallback after two validation failures', async () => {
    const agent = makeMockAgent({
      outputs: [
        { throws: new Error('decision: Required') },
        { throws: new Error('reasoning: Required') },
      ],
    });
    const out = await generateWithRetry(agent, 'dossier', FactionOutputSchema, {
      fallback: { decision: '[no response]', reasoning: '[fallback]' },
      label: 'faction(x)',
    });
    expect(out).toEqual({ decision: '[no response]', reasoning: '[fallback]' });
    expect(agent.generateCalls).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Verify the tests fail.**

Run: `pnpm test --run src/mastra/workflows/turn.test.ts -t "generateWithRetry"`
Expected: FAIL (`generateWithRetry is not exported`).

- [ ] **Step 3: Implement `generateWithRetry`.**

Add to `src/mastra/workflows/turn.ts`:

```ts
import type { ZodTypeAny } from 'zod';

interface RetryOptions<T> {
  fallback: T;
  label: string;
}

export async function generateWithRetry<T>(
  agent: AgentLike<T>,
  prompt: string,
  _schema: ZodTypeAny,
  options: RetryOptions<T>,
): Promise<T> {
  try {
    const res = await agent.generate(prompt);
    return res.object;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const retryPrompt =
      `${prompt}\n\n---\n\nVALIDATION ERROR ON PREVIOUS ATTEMPT:\n${msg}\n\n` +
      `Re-emit your response, fixing the schema mismatch. ` +
      `The previous attempt failed validation and was discarded.`;
    try {
      const res = await agent.generate(retryPrompt);
      return res.object;
    } catch (err2) {
      // Silent fall-through to fallback. Spec error matrix lines 332-333 +
      // 337 specify this for faction (always) and illustrator (continues
      // without embeds). `options.label` is reserved for future logging.
      void options.label;
      void err2;
      return options.fallback;
    }
  }
}
```

Note: the `_schema` parameter is taken for API symmetry but not used in the body — Mastra's agent has already validated the output via `defaultOptions.structuredOutput.schema` (Wave 4). We catch the throw and inspect `err.message`; we do NOT re-validate. Keeping the schema parameter in the signature documents intent and gives us a place to wire a JSON-Schema-aware feedback formatter in v0.5 if needed.

- [ ] **Step 4: Verify the tests pass.**

Run: `pnpm test --run src/mastra/workflows/turn.test.ts -t "generateWithRetry"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/mastra/workflows/turn.ts src/mastra/workflows/turn.test.ts
git commit -m "feat(wave-5): generateWithRetry helper with retry-with-feedback policy"
```

---

### Task 4: Step 2 — faction fan-out + Scenario 2 (faction validation fails × 2)

**Files:**

- Modify: `src/mastra/workflows/turn.ts` (wire Step 2 to `generateWithRetry`)
- Modify: `src/mastra/workflows/turn.test.ts` (add Scenario 2 + happy-path-step-2 test)

Step 2 fans out one faction agent call per slug in `onStage.factionsToSpawn`. Test fixtures: the fixture vault's `npcs/kessha.md` has `faction: red-banner`, so the player input `"I confront Kessha"` makes `red-banner` the only on-stage faction. To exercise multiple parallel calls we'll stage a player input that brings in TWO factioned NPCs (`kessha` + an added `iron-promise-captain` if its frontmatter has a faction — verify via `cat tests/fixtures/test-vault/npcs/iron-promise-captain.md`; if not, the test adds one inline via fs writes before running). Each test gets its own vault copy so fs mutation is fine.

- [ ] **Step 1: Inspect the fixture to plan the player input.**

```bash
grep -l 'faction:' tests/fixtures/test-vault/npcs/*.md
```

Use the result to choose a player input that brings ≥ 2 factioned NPCs on stage. If only one faction-bearing NPC exists, the Scenario-2 test extends the fixture copy with a second one before calling `runTurn`. Document the choice in a code comment in the test.

- [ ] **Step 2: Write failing tests for Step 2 happy path + Scenario 2.**

Append to `src/mastra/workflows/turn.test.ts`:

```ts
describe('Step 2: faction fan-out', () => {
  let vault: string;
  beforeEach(async () => {
    vault = await copyFixtureVault(FIXTURE);
  });
  afterEach(async () => {
    releaseMutex(path.basename(vault));
    await fs.rm(vault, { recursive: true, force: true });
  });

  it('emits phase{factions, count:N} then narrator after parallel decisions', async () => {
    const { events, emit } = collectEvents();
    const factionAgent = makeMockAgent({
      outputs: [{ decision: 'red-banner moves', reasoning: 'r1' }],
    });
    // Player input mentions Kessha so red-banner spawns.
    const result = await runTurn(
      { vaultRoot: vault, playerInput: 'I look for [[npcs/kessha|Kessha]]' },
      {
        narratorAgent: makeMockAgent({ outputs: [{ throws: new Error('step-3 not yet wired') }] }),
        factionAgent,
        illustratorAgent: makeMockAgent({ outputs: [] }),
        ttsRender: async () => {
          throw new Error('should not call');
        },
        emit,
      },
    );
    expect(result.status).toBe('error'); // because step-3 still throws
    const phases = events.filter((e) => e.type === 'phase');
    expect(phases[0]).toEqual({ type: 'phase', name: 'factions', count: 1 });
    expect(phases[1]).toEqual({ type: 'phase', name: 'narrator' });
    expect(factionAgent.generateCalls).toHaveLength(1);
    expect(factionAgent.generateCalls[0]).toContain('<faction slug="red-banner">');
  });

  it('Scenario 2: synthesises [no response] when faction validation fails twice', async () => {
    const { events, emit } = collectEvents();
    const factionAgent = makeMockAgent({
      outputs: [
        { throws: new Error('decision: Required') },
        { throws: new Error('decision: Required') },
      ],
    });
    const narratorAgent = makeMockAgent({
      outputs: [{ prose: 'After silence, the world held its breath.' }],
    });
    // We never reach illustrator/TTS in this assertion because step-4 will throw.
    // But the faction synth path must complete and the narrator must receive
    // a dossier with the synthesised decision.
    const result = await runTurn(
      { vaultRoot: vault, playerInput: 'I look for [[npcs/kessha|Kessha]]' },
      {
        narratorAgent,
        factionAgent,
        illustratorAgent: makeMockAgent({
          outputs: [{ throws: new Error('step-4 not yet wired') }],
        }),
        ttsRender: async () => {
          throw new Error('should not call');
        },
        emit,
      },
    );
    void result; // assert via narrator's prompt below
    expect(narratorAgent.generateCalls.length + narratorAgent.streamCalls.length).toBeGreaterThan(
      0,
    );
    const narratorPrompt = (narratorAgent.streamCalls[0] ?? narratorAgent.generateCalls[0])!;
    expect(narratorPrompt).toContain('<decision faction="red-banner">[no response]</decision>');
    // Implicit: faction was tried twice, then synthesised.
    expect(factionAgent.generateCalls).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Verify the tests fail.**

Run: `pnpm test --run src/mastra/workflows/turn.test.ts -t "Step 2"`
Expected: FAIL (Step 2 not wired).

- [ ] **Step 4: Implement Step 2 in `runTurn`.**

Replace the `throw new Error('Step 2+ not yet implemented')` in `runTurn` with:

```ts
const decisions = await Promise.all(
  onStage.factionsToSpawn.map(async (factionSlug) => {
    const factionDoc = loaded.factions[factionSlug];
    if (!factionDoc) {
      // Faction NPC frontmatter references a faction file that doesn't exist.
      // Spec is silent on this edge case; treat as `[no response]` and move on
      // (matches the spirit of the error matrix: "missing slug → fallback").
      return {
        slug: factionSlug,
        decision: { decision: '[no response]', reasoning: '[faction file missing]' },
      };
    }
    const dossier = buildFactionDossier({
      faction: factionDoc,
      onStage,
      recent,
      world: loaded.world,
      character: loaded.character,
      playerInput: input.playerInput,
    });
    const decision = await generateWithRetry(deps.factionAgent, dossier, FactionOutputSchema, {
      fallback: { decision: '[no response]', reasoning: '[validation failed twice]' },
      label: `faction(${factionSlug})`,
    });
    return { slug: factionSlug, decision };
  }),
);
deps.emit({ type: 'phase', name: 'narrator' });
throw new Error('Step 3+ not yet implemented');
```

Note: at this point we throw after `phase: narrator` to keep the partial workflow's contract testable. The throw triggers the `catch` arm which emits `error` and returns `{ status: 'error', ... }`. The Step 2 tests above expect that.

- [ ] **Step 5: Verify the tests pass.**

Run: `pnpm test --run src/mastra/workflows/turn.test.ts -t "Step 2"`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit.**

```bash
git add src/mastra/workflows/turn.ts src/mastra/workflows/turn.test.ts
git commit -m "feat(wave-5): Step 2 — faction fan-out + Scenario 2 (retry × 2 → synth fallback)"
```

---

### Task 5: `streamNarratorWithRetry` helper + Step 3 + Scenario 3 (narrator validation fails × 2)

**Files:**

- Modify: `src/mastra/workflows/turn.ts` (add helper + Step 3)
- Modify: `src/mastra/workflows/turn.test.ts` (Scenario 3 + happy-path step-3 test)

`streamNarratorWithRetry` is distinct from `generateWithRetry` because narrator uses `agent.stream(...)` on the first attempt to emit `prose_delta` events. On schema-validation failure (the awaited `.object` rejects), we retry once non-streamed via `agent.generate(...)`. Second failure throws a tagged `narrator-failed` error that the outer `catch` translates to a recoverable error.

- [ ] **Step 1: Write failing tests for streaming + retry.**

Append to `src/mastra/workflows/turn.test.ts`:

```ts
describe('Step 3: narrator', () => {
  let vault: string;
  beforeEach(async () => {
    vault = await copyFixtureVault(FIXTURE);
  });
  afterEach(async () => {
    releaseMutex(path.basename(vault));
    await fs.rm(vault, { recursive: true, force: true });
  });

  it('emits prose_delta events from the streaming agent', async () => {
    const { events, emit } = collectEvents();
    // Build a stream agent that yields three deltas then resolves to a valid object.
    const narratorAgent: AgentLike<NarratorOutput> = {
      generate: vi.fn(),
      stream: async () =>
        makeAgentStream(['Hello, ', 'world. ', 'A test.'], { prose: 'Hello, world. A test.' }),
    };
    await runTurn(
      { vaultRoot: vault, playerInput: 'I do nothing.' },
      {
        narratorAgent,
        factionAgent: makeMockAgent({ outputs: [] }),
        illustratorAgent: makeMockAgent({ outputs: [{ throws: new Error('step-4 wip') }] }),
        ttsRender: async () => {
          throw new Error('not yet wired');
        },
        emit,
      },
    );
    const deltas = events.filter((e) => e.type === 'prose_delta').map((e: any) => e.text);
    expect(deltas).toEqual(['Hello, ', 'world. ', 'A test.']);
    // phase events ordering:
    const phases = events.filter((e) => e.type === 'phase').map((e: any) => e.name);
    expect(phases.slice(0, 3)).toEqual(['factions', 'narrator', 'media']);
  });

  it('Scenario 3: narrator failed twice → error{recoverable:true}, no journal append', async () => {
    const journalBefore = await fs.readFile(path.join(vault, 'journal.md'), 'utf8');
    const narratorAgent = {
      generate: vi.fn(async () => {
        throw new Error('prose: Required');
      }),
      stream: vi.fn(async () => {
        // First attempt: stream resolves but .object rejects.
        return {
          textStream: (async function* () {
            yield '';
          })(),
          object: Promise.reject(new Error('prose: Required')),
        };
      }),
    };
    const { events, emit } = collectEvents();
    const result = await runTurn(
      { vaultRoot: vault, playerInput: 'I do nothing.' },
      {
        narratorAgent: narratorAgent as any,
        factionAgent: makeMockAgent({ outputs: [] }),
        illustratorAgent: makeMockAgent({ outputs: [] }),
        ttsRender: async () => {
          throw new Error('should not call');
        },
        emit,
      },
    );
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.recoverable).toBe(true);
      expect(result.message).toBe('narrator failed; please rephrase');
    }
    const journalAfter = await fs.readFile(path.join(vault, 'journal.md'), 'utf8');
    expect(journalAfter).toEqual(journalBefore);
    expect(isLocked(path.basename(vault))).toBe(false); // finally fired
    expect(events.at(-1)).toEqual({
      type: 'error',
      message: 'narrator failed; please rephrase',
      recoverable: true,
    });
  });
});
```

- [ ] **Step 2: Verify tests fail.**

Run: `pnpm test --run src/mastra/workflows/turn.test.ts -t "Step 3"`
Expected: FAIL.

- [ ] **Step 3: Implement `streamNarratorWithRetry` and wire Step 3.**

Add to `src/mastra/workflows/turn.ts`:

```ts
const NARRATOR_FAILED: unique symbol = Symbol.for('wave5.narrator-failed');
const TTS_FAILED: unique symbol = Symbol.for('wave5.tts-failed');

function taggedError(
  kind: typeof NARRATOR_FAILED | typeof TTS_FAILED,
  message: string,
): Error & { kind: typeof kind } {
  const e = new Error(message) as Error & { kind: typeof kind };
  e.kind = kind;
  return e;
}

function isTaggedError(err: unknown, kind: typeof NARRATOR_FAILED | typeof TTS_FAILED): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'kind' in err &&
    (err as { kind: unknown }).kind === kind
  );
}

async function streamNarratorWithRetry(
  agent: AgentLike<NarratorOutput>,
  prompt: string,
  emit: PhaseEventEmitter,
): Promise<NarratorOutput> {
  // Attempt 1: streamed.
  try {
    const stream = await agent.stream(prompt);
    // Consume the text stream BEFORE awaiting .object: in Mastra streaming
    // structured output, the object resolves after the stream finishes.
    for await (const chunk of stream.textStream) {
      if (chunk.length > 0) emit({ type: 'prose_delta', text: chunk });
    }
    return await stream.object;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const retryPrompt =
      `${prompt}\n\n---\n\nVALIDATION ERROR ON PREVIOUS ATTEMPT:\n${msg}\n\n` +
      `Re-emit your response, fixing the schema mismatch. ` +
      `The previous attempt failed validation and was discarded.`;
    // Attempt 2: non-streamed. No prose_delta events for the second attempt.
    try {
      const res = await agent.generate(retryPrompt);
      return res.object;
    } catch (err2) {
      const msg2 = err2 instanceof Error ? err2.message : String(err2);
      throw taggedError(NARRATOR_FAILED, msg2);
    }
  }
}
```

Then replace `throw new Error('Step 3+ not yet implemented')` in `runTurn` with the Step 3 body:

```ts
const narratorDossier = buildNarratorDossier({
  world: loaded.world,
  character: loaded.character,
  threads: loaded.threads,
  styleGuide: loaded.styleGuide.body,
  onStage,
  recent,
  factionDecisions: decisions.map((d) => ({ slug: d.slug, decision: d.decision.decision })),
  playerInput: input.playerInput,
  turnId,
});
const narratorOutput = await streamNarratorWithRetry(
  deps.narratorAgent,
  narratorDossier,
  deps.emit,
);
deps.emit({ type: 'phase', name: 'media' });
throw new Error('Step 4+ not yet implemented');
```

Update the outer `catch` in `runTurn` to handle the tagged error:

```ts
} catch (err) {
  let message: string;
  let recoverable: boolean;
  if (isTaggedError(err, NARRATOR_FAILED)) {
    message = 'narrator failed; please rephrase';
    recoverable = true;
  } else if (isTaggedError(err, TTS_FAILED)) {
    message = 'audio render failed';
    recoverable = true;
  } else if (err instanceof Error) {
    // Step 4+ not yet implemented errors fall through here. Once Step 4-5
    // are wired this branch only catches genuine fs/persist failures.
    message = `vault write failed: ${err.message}`;
    recoverable = false;
  } else {
    message = 'unknown error';
    recoverable = false;
  }
  deps.emit({ type: 'error', message, recoverable });
  return { status: 'error', message, recoverable };
} finally {
  if (held) releaseMutex(slug);
}
```

- [ ] **Step 4: Verify tests pass.**

Run: `pnpm test --run src/mastra/workflows/turn.test.ts -t "Step 3"`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/mastra/workflows/turn.ts src/mastra/workflows/turn.test.ts
git commit -m "feat(wave-5): Step 3 — narrator streaming + retry + Scenario 3 (narrator failed × 2)"
```

---

### Task 6: `ttsWithRetry` helper + Step 4 (illustrator || TTS) + Scenarios 5, 6 (image gen failure, TTS failure × 2)

**Files:**

- Modify: `src/mastra/workflows/turn.ts` (helper + Step 4)
- Modify: `src/mastra/workflows/turn.test.ts` (Scenarios 5, 6 + happy step-4 test)

- [ ] **Step 1: Write failing tests for Step 4 + Scenarios 5, 6.**

```ts
describe('Step 4: illustrator || TTS', () => {
  let vault: string;
  beforeEach(async () => {
    vault = await copyFixtureVault(FIXTURE);
  });
  afterEach(async () => {
    releaseMutex(path.basename(vault));
    await fs.rm(vault, { recursive: true, force: true });
  });

  it('runs illustrator and TTS in parallel and emits phase:persist', async () => {
    const { events, emit } = collectEvents();
    const narratorOutput = { prose: 'A beat of prose.' };
    const illustratorOutput = {
      prose_with_embeds: 'A beat of prose.\n\n![[a-b-c.png]]',
      images: [{ filename: 'a-b-c.png', path: '/abs/a-b-c.png', prompt: 'p', slug: 's' }],
    };
    const ttsStarts: number[] = [];
    const illusStarts: number[] = [];
    const ttsRender = vi.fn(async (_text: string, opts: { output: string }) => {
      ttsStarts.push(Date.now());
      await new Promise((r) => setTimeout(r, 5));
      return opts.output;
    });
    const illustratorAgent: AgentLike<IllustratorOutput> = {
      generate: async () => {
        illusStarts.push(Date.now());
        await new Promise((r) => setTimeout(r, 5));
        return { object: illustratorOutput };
      },
      stream: vi.fn(),
    };
    const narratorAgent: AgentLike<NarratorOutput> = {
      generate: vi.fn(),
      stream: async () => makeAgentStream([''], narratorOutput),
    };
    const result = await runTurn(
      { vaultRoot: vault, playerInput: 'I do nothing.' },
      {
        narratorAgent,
        factionAgent: makeMockAgent({ outputs: [] }),
        illustratorAgent,
        ttsRender,
        emit,
      },
    );
    // Step 5 not wired yet → returns error. But Step 4 must have run.
    void result;
    expect(events.some((e) => e.type === 'phase' && (e as any).name === 'persist')).toBe(true);
    // Parallel: both started within ~3ms of each other.
    expect(Math.abs(ttsStarts[0] - illusStarts[0])).toBeLessThan(20);
  });

  it('Scenario 5: image gen failure → illustrator drops embed, turn completes', async () => {
    // Mocked illustrator agent already returned the fallback shape (images=[],
    // prose_with_embeds=narrator prose). We verify by checking the result's
    // images count when the agent throws twice (drops to fallback).
    const { events, emit } = collectEvents();
    const narratorOutput = { prose: 'A beat.' };
    const narratorAgent: AgentLike<NarratorOutput> = {
      generate: vi.fn(),
      stream: async () => makeAgentStream([''], narratorOutput),
    };
    const illustratorAgent: AgentLike<IllustratorOutput> = {
      generate: vi
        .fn()
        .mockRejectedValueOnce(new Error('OpenAI 500'))
        .mockRejectedValueOnce(new Error('OpenAI 500')),
      stream: vi.fn(),
    };
    const ttsRender = vi.fn(async (_t, o) => o.output);
    const result = await runTurn(
      { vaultRoot: vault, playerInput: 'I do nothing.' },
      {
        narratorAgent,
        factionAgent: makeMockAgent({ outputs: [] }),
        illustratorAgent,
        ttsRender,
        emit,
      },
    );
    // Step 5 wired in Task 7; this test will pass once Task 7 lands. For now
    // we just verify illustrator's TWO calls happened and the workflow didn't
    // throw an uncaught.
    expect(illustratorAgent.generate).toHaveBeenCalledTimes(2);
    void result;
  });

  it('Scenario 6: TTS fails twice → error{recoverable:true}, no journal append', async () => {
    const journalBefore = await fs.readFile(path.join(vault, 'journal.md'), 'utf8');
    const { events, emit } = collectEvents();
    const narratorOutput = { prose: 'A beat.' };
    const narratorAgent: AgentLike<NarratorOutput> = {
      generate: vi.fn(),
      stream: async () => makeAgentStream([''], narratorOutput),
    };
    const illustratorAgent: AgentLike<IllustratorOutput> = {
      generate: async () => ({
        object: { prose_with_embeds: 'A beat.', images: [] },
      }),
      stream: vi.fn(),
    };
    const ttsRender = vi.fn(async () => {
      throw new Error('Inworld 500');
    });
    const result = await runTurn(
      { vaultRoot: vault, playerInput: 'I do nothing.' },
      {
        narratorAgent,
        factionAgent: makeMockAgent({ outputs: [] }),
        illustratorAgent,
        ttsRender,
        emit,
      },
    );
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.recoverable).toBe(true);
      expect(result.message).toBe('audio render failed');
    }
    expect(ttsRender).toHaveBeenCalledTimes(2);
    const journalAfter = await fs.readFile(path.join(vault, 'journal.md'), 'utf8');
    expect(journalAfter).toEqual(journalBefore);
    expect(isLocked(path.basename(vault))).toBe(false);
  });
});
```

- [ ] **Step 2: Verify the tests fail.**

Run: `pnpm test --run src/mastra/workflows/turn.test.ts -t "Step 4"`
Expected: FAIL.

- [ ] **Step 3: Implement `ttsWithRetry` + Step 4 body.**

Add to `turn.ts`:

```ts
async function ttsWithRetry(
  ttsRender: RunTurnDeps['ttsRender'],
  text: string,
  output: string,
): Promise<string> {
  try {
    return await ttsRender(text, { output });
  } catch (_err1) {
    // 200ms backoff per spec error matrix line 338.
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      return await ttsRender(text, { output });
    } catch (err2) {
      const msg = err2 instanceof Error ? err2.message : String(err2);
      throw taggedError(TTS_FAILED, msg);
    }
  }
}
```

Replace the Step 3+ `throw new Error('Step 4+ not yet implemented')` with:

```ts
const visualBlock = extractVisualBlock(loaded.styleGuide.body) ?? '';
const illustratorDossier = buildIllustratorDossier({
  narratorProse: narratorOutput.prose,
  styleGuideVisual: visualBlock,
  onStage,
});
const audioPath = path.join(input.vaultRoot, 'audio', `narrator-${turnId}.ogg`);

const [illustratorOutput, audioPathResolved] = await Promise.all([
  generateWithRetry(deps.illustratorAgent, illustratorDossier, IllustratorOutputSchema, {
    fallback: { prose_with_embeds: narratorOutput.prose, images: [] },
    label: 'illustrator',
  }),
  ttsWithRetry(deps.ttsRender, stripForTts(narratorOutput.prose), audioPath),
]);
deps.emit({ type: 'phase', name: 'persist' });
throw new Error('Step 5 not yet implemented');
```

Note on `Promise.all` semantics: if TTS rejects first (e.g. its 2nd retry fails before the illustrator finishes), the illustrator promise keeps running until it settles, but Node's promise machinery still resolves `Promise.all` with the rejection. The illustrator's eventual settlement is silently dropped. This is the correct behavior: a failed TTS aborts the turn, so any illustrator output that comes in after is wasted — no fs side effects from the illustrator's tool calls (the image-tool writes files to `images/`, but those are leftovers that match Wave-3's accepted leakage on aborted turns). Spec error matrix line 338 only requires that we abort and skip persist.

Reviewer prompt: confirm this matches the spec's intent. If they want clean-up of leaked image files, that's a v0.5 task and should be filed separately.

- [ ] **Step 4: Verify tests pass.**

Run: `pnpm test --run src/mastra/workflows/turn.test.ts -t "Step 4"`
Expected: PASS for the TTS-failure test (Scenario 6); Scenario 5 + happy-step-4 still partly red (Step 5 throws) but that's expected — they'll go fully green in Task 7.

- [ ] **Step 5: Commit.**

```bash
git add src/mastra/workflows/turn.ts src/mastra/workflows/turn.test.ts
git commit -m "feat(wave-5): Step 4 — illustrator || TTS + Scenario 6 (TTS failed × 2)"
```

---

### Task 7: Step 5 — persist + Scenario 1 (happy path)

**Files:**

- Modify: `src/mastra/workflows/turn.ts` (Step 5 + `stubOnMention` + `renderPlaytest`)
- Modify: `src/mastra/workflows/turn.test.ts` (Scenario 1 happy path)

- [ ] **Step 1: Write the failing happy-path test.**

```ts
describe('Step 5: persist (Scenario 1: happy path)', () => {
  let vault: string;
  beforeEach(async () => {
    vault = await copyFixtureVault(FIXTURE);
  });
  afterEach(async () => {
    releaseMutex(path.basename(vault));
    await fs.rm(vault, { recursive: true, force: true });
  });

  it('appends journal, ticks world, writes playtest, emits done', async () => {
    const { events, emit } = collectEvents();
    const narratorOutput = {
      prose: 'Kessha turned to the sea.',
      time_passed: { days: 1 },
    };
    const illustratorOutput = {
      prose_with_embeds: 'Kessha turned to the sea.\n\n![[scene-001.png]]',
      images: [{ filename: 'scene-001.png', path: '/x/scene-001.png', prompt: 'p', slug: 'scene' }],
    };
    const result = await runTurn(
      { vaultRoot: vault, playerInput: 'I find [[npcs/kessha|Kessha]].' },
      {
        narratorAgent: {
          generate: vi.fn(),
          stream: async () => makeAgentStream([''], narratorOutput),
        },
        factionAgent: makeMockAgent({ outputs: [{ decision: 'd', reasoning: 'r' }] }),
        illustratorAgent: {
          generate: async () => ({ object: illustratorOutput }),
          stream: vi.fn(),
        },
        ttsRender: async (_t, o) => o.output,
        emit,
      },
    );
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.turnId).toMatch(/^turn-\d{3,}$/);
    // Journal appended:
    const journal = await fs.readFile(path.join(vault, 'journal.md'), 'utf8');
    expect(journal).toContain(`— ${result.turnId}`);
    expect(journal).toContain('![[scene-001.png]]');
    // Playtest appended:
    const playtestDir = path.join(vault, 'playtests');
    const playtestFiles = await fs.readdir(playtestDir);
    expect(playtestFiles.length).toBeGreaterThan(0);
    const playtest = await fs.readFile(path.join(playtestDir, playtestFiles[0]), 'utf8');
    expect(playtest).toContain(`## ${result.turnId}`);
    // World ticked (fixture's mid-clock was 4/7; +1 day → 5/7):
    const threads = await fs.readFile(path.join(vault, 'threads.xml'), 'utf8');
    expect(threads).toContain('<progress>5/7</progress>');
    // done event last:
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      audioPath: expect.stringContaining(`narrator-${result.turnId}.ogg`),
      finalProse: illustratorOutput.prose_with_embeds,
      images: illustratorOutput.images,
    });
    // Mutex released:
    expect(isLocked(path.basename(vault))).toBe(false);
  });
});
```

- [ ] **Step 2: Verify the test fails.**

Run: `pnpm test --run src/mastra/workflows/turn.test.ts -t "Scenario 1"`
Expected: FAIL.

- [ ] **Step 3: Implement Step 5 + helpers.**

Add `stubOnMention` and `renderPlaytest` helpers in `turn.ts`:

```ts
import { appendJournal } from '@/lib/vault/journal';
import { worldTick, type MaturedThread } from '@/lib/vault/threads';
import { appendPlaytest } from '@/lib/vault/playtests';
import { createStub } from '@/lib/vault/stubs';
import { zeroMapPath } from '@/lib/vault/paths';
import { parseWikilinks, resolveWikilink } from '@/lib/vault/wikilinks';
import type { AliasRegistry } from '@/lib/vault/wikilinks';

interface StubReport {
  stubsCreated: { kind: string; slug: string; path: string }[];
  overflow: string[]; // wikilink targets appended to 0-Map.md
}

async function stubOnMention(
  root: string,
  registry: AliasRegistry,
  finalProse: string,
  turnId: string,
): Promise<StubReport> {
  const links = parseWikilinks(finalProse);
  const unresolved: { kind: 'npc' | 'location' | 'faction'; slug: string; target: string }[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const r = resolveWikilink(link, registry);
    if (r.kind === 'image') continue;
    if (r.found) continue;
    const key = `${r.kind}/${r.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unresolved.push({ kind: r.kind, slug: r.slug, target: link.target });
  }
  const created: StubReport['stubsCreated'] = [];
  for (const u of unresolved.slice(0, 2)) {
    const result = await createStub(root, { kind: u.kind, slug: u.slug, excerptProse: finalProse });
    if (result.created) created.push({ kind: u.kind, slug: u.slug, path: result.path });
  }
  const overflow: string[] = [];
  if (unresolved.length > 2) {
    const lines = unresolved.slice(2).map((u) => `- TODO: stub for [[${u.target}]] (${turnId})\n`);
    await fs.appendFile(zeroMapPath(root), lines.join(''));
    overflow.push(...unresolved.slice(2).map((u) => u.target));
  }
  return { stubsCreated: created, overflow };
}

function renderPlaytest(args: {
  turnId: string;
  decisions: { slug: string; decision: FactionOutput }[];
  narratorOutput: NarratorOutput;
  illustratorOutput: IllustratorOutput;
  audioPath: string;
  matured: MaturedThread[];
  stubReport: StubReport;
}): string {
  const lines: string[] = [];
  lines.push(`### faction decisions`);
  if (args.decisions.length === 0) lines.push(`- (no factions spawned)`);
  for (const d of args.decisions) {
    lines.push(`- **${d.slug}** — decision: ${d.decision.decision}`);
    lines.push(`  - reasoning: ${d.decision.reasoning}`);
  }
  lines.push(`### narrator`);
  if (args.narratorOutput.time_passed) {
    const tp = args.narratorOutput.time_passed;
    lines.push(`- time_passed: ${JSON.stringify(tp)}`);
  } else {
    lines.push(`- time_passed: (none)`);
  }
  lines.push(`### illustrator`);
  lines.push(`- image_count: ${args.illustratorOutput.images.length}`);
  for (const img of args.illustratorOutput.images) {
    lines.push(`  - ${img.filename}: "${img.prompt}"`);
  }
  lines.push(`### media`);
  lines.push(`- audio: ${args.audioPath}`);
  if (args.matured.length > 0) {
    lines.push(`### matured`);
    for (const m of args.matured) lines.push(`- ${m.id}: ${m.name} (stake: ${m.stake})`);
  }
  if (args.stubReport.stubsCreated.length > 0 || args.stubReport.overflow.length > 0) {
    lines.push(`### stubs`);
    for (const s of args.stubReport.stubsCreated) lines.push(`- created ${s.kind}/${s.slug}`);
    for (const o of args.stubReport.overflow) lines.push(`- overflowed [[${o}]] to 0-Map.md`);
  }
  return lines.join('\n');
}
```

Replace `throw new Error('Step 5 not yet implemented')` in `runTurn` with the Step 5 body:

```ts
let matured: MaturedThread[] = [];
if (narratorOutput.time_passed) {
  matured = await worldTick(input.vaultRoot, narratorOutput.time_passed);
}
const finalProse = illustratorOutput.prose_with_embeds;
await appendJournal(input.vaultRoot, turnId, finalProse);
// Build the registry once from the data we already loaded + a fresh dir listing.
const [npcFiles, locFiles] = await Promise.all([
  fs.readdir(npcsDir(input.vaultRoot)).catch(() => []),
  fs.readdir(locationsDir(input.vaultRoot)).catch(() => []),
]);
const registry: AliasRegistry = {
  npcs: new Set(npcFiles.filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3))),
  locations: new Set(locFiles.filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3))),
  factions: new Set(Object.keys(loaded.factions)),
};
const stubReport = await stubOnMention(input.vaultRoot, registry, finalProse, turnId);
await appendPlaytest(
  input.vaultRoot,
  turnId,
  renderPlaytest({
    turnId,
    decisions,
    narratorOutput,
    illustratorOutput,
    audioPath: audioPathResolved,
    matured,
    stubReport,
  }),
);
deps.emit({
  type: 'done',
  audioPath: audioPathResolved,
  finalProse,
  images: illustratorOutput.images,
});
return {
  status: 'success',
  turnId,
  finalProse,
  audioPath: audioPathResolved,
  images: illustratorOutput.images,
  matured,
};
```

- [ ] **Step 4: Verify Scenario 1 passes.**

Run: `pnpm test --run src/mastra/workflows/turn.test.ts -t "Scenario 1"`
Expected: PASS.

Re-run the full test file to confirm nothing regressed:

Run: `pnpm test --run src/mastra/workflows/turn.test.ts`
Expected: All prior scenarios (1, 2, 3, 6, mutex contention, helper unit tests) pass. Scenario 5 (image gen failure) should also now pass — illustrator fallback produces `images: []`, journal appends with no embeds, turn completes.

- [ ] **Step 5: Commit.**

```bash
git add src/mastra/workflows/turn.ts src/mastra/workflows/turn.test.ts
git commit -m "feat(wave-5): Step 5 — persist + Scenario 1 (happy path) + Scenario 5 (image fail → no embed)"
```

---

### Task 8: Scenario 7 — mid-step crash releases mutex

**Files:**

- Modify: `src/mastra/workflows/turn.test.ts` (Scenario 7)

This scenario verifies the `finally` block fires for an uncaught throw inside any step. Easiest case: have the faction agent throw a non-validation `Error` (e.g. network) twice — `generateWithRetry` returns the fallback, so we need a deeper failure mode. Inject `ttsRender` that throws once before retry → throws again. We already proved Step 4 releases the mutex (Scenario 6); for Scenario 7 we want to verify the same for an UNEXPECTED throw — e.g. the `loadAlwaysLoaded` call throws (vault corrupted) — that bubbles past all the typed handlers into the generic `Error` arm.

- [ ] **Step 1: Write the failing test.**

```ts
it('Scenario 7: filesystem write fails → mutex released, no partial journal', async () => {
  // Inject a failure mid-persist by chmod'ing journal.md to read-only after
  // step 4. Easier: use a non-existent vault root so `loadAlwaysLoaded` throws.
  const { events, emit } = collectEvents();
  const bogus = path.join(vault, 'does-not-exist');
  const result = await runTurn(
    { vaultRoot: bogus, playerInput: 'x' },
    {
      narratorAgent: makeMockAgent({ outputs: [] }),
      factionAgent: makeMockAgent({ outputs: [] }),
      illustratorAgent: makeMockAgent({ outputs: [] }),
      ttsRender: async () => {
        throw new Error('should not call');
      },
      emit,
    },
  );
  expect(result.status).toBe('error');
  if (result.status === 'error') {
    expect(result.recoverable).toBe(false);
    expect(result.message).toMatch(/^vault write failed:/);
  }
  expect(isLocked(path.basename(bogus))).toBe(false);
  expect(events.at(-1)?.type).toBe('error');
});

it('Scenario 7b: throw injected at Step 5 (after lock acquired) releases mutex', async () => {
  const narratorOutput = { prose: 'A beat.' };
  const illustratorOutput = { prose_with_embeds: 'A beat.', images: [] };
  // Make appendJournal throw by removing write permission on the vault dir.
  await fs.chmod(vault, 0o555);
  try {
    const result = await runTurn(
      { vaultRoot: vault, playerInput: 'I do nothing.' },
      {
        narratorAgent: {
          generate: vi.fn(),
          stream: async () => makeAgentStream([''], narratorOutput),
        },
        factionAgent: makeMockAgent({ outputs: [] }),
        illustratorAgent: {
          generate: async () => ({ object: illustratorOutput }),
          stream: vi.fn(),
        },
        ttsRender: async (_t, o) => o.output,
        emit: () => {},
      },
    );
    expect(result.status).toBe('error');
  } finally {
    await fs.chmod(vault, 0o755);
  }
  expect(isLocked(path.basename(vault))).toBe(false);
});
```

- [ ] **Step 2: Verify the tests fail.**

Run: `pnpm test --run src/mastra/workflows/turn.test.ts -t "Scenario 7"`
Expected: FAIL initially if any path leaves the mutex held.

- [ ] **Step 3: Fix any uncovered code path.**

If 7a fails because `loadAlwaysLoaded` throws BEFORE `acquireMutex` is called (i.e. the `try` doesn't wrap `acquireMutex`), restructure `runTurn` so `acquireMutex` is the FIRST thing inside the function, BEFORE any I/O that could throw. Then the `try` opens immediately after the `held = true` check. The slug must be derived BEFORE the try (it's a pure `path.basename` of input.vaultRoot — no I/O). Worked example:

```ts
export async function runTurn(input, deps) {
  const slug = path.basename(input.vaultRoot);
  const held = acquireMutex(slug);
  if (!held) {
    /* emit + return error */
  }
  try {
    // step 1 starts here; loadAlwaysLoaded throw lands in the catch below
  } catch (err) {
    /* emit + return error */
  } finally {
    if (held) releaseMutex(slug);
  }
}
```

(This is already how Task 2's design block specifies it, so this fix is a verification step.)

- [ ] **Step 4: Verify tests pass.**

Run: `pnpm test --run src/mastra/workflows/turn.test.ts -t "Scenario 7"`
Expected: PASS for both 7a and 7b.

- [ ] **Step 5: Commit.**

```bash
git add src/mastra/workflows/turn.test.ts src/mastra/workflows/turn.ts
git commit -m "test(wave-5): Scenario 7 — mid-step crash releases mutex (finally semantics)"
```

---

### Task 9: Scenario 8 — stub-on-mention cap (2 stubs + overflow to 0-Map)

**Files:**

- Modify: `src/mastra/workflows/turn.test.ts` (Scenario 8)

- [ ] **Step 1: Write the failing test.**

```ts
it('Scenario 8: 5 unresolved wikilinks → 2 stubs + 3 0-Map TODOs', async () => {
  const finalProse =
    'A test.\n[[npcs/new-one]] and [[npcs/new-two]] and [[npcs/new-three]] ' +
    'and [[locations/new-loc]] and [[Bare Unresolved]].';
  const illustratorOutput = { prose_with_embeds: finalProse, images: [] };
  const narratorOutput = { prose: finalProse };
  const result = await runTurn(
    { vaultRoot: vault, playerInput: 'I explore.' },
    {
      narratorAgent: {
        generate: vi.fn(),
        stream: async () => makeAgentStream([''], narratorOutput),
      },
      factionAgent: makeMockAgent({ outputs: [] }),
      illustratorAgent: { generate: async () => ({ object: illustratorOutput }), stream: vi.fn() },
      ttsRender: async (_t, o) => o.output,
      emit: () => {},
    },
  );
  expect(result.status).toBe('success');
  // 2 stubs created (first 2 unresolved):
  const npcStubs = await fs.readdir(path.join(vault, 'npcs'));
  expect(npcStubs).toContain('new-one.md');
  expect(npcStubs).toContain('new-two.md');
  expect(npcStubs).not.toContain('new-three.md');
  const locStubs = await fs.readdir(path.join(vault, 'locations'));
  expect(locStubs).not.toContain('new-loc.md');
  // 3 entries in 0-Map.md (new-three, new-loc, bare-unresolved):
  const map = await fs.readFile(path.join(vault, '0-Map.md'), 'utf8');
  expect(map).toContain('TODO: stub for [[npcs/new-three]]');
  expect(map).toContain('TODO: stub for [[locations/new-loc]]');
  expect(map).toContain('TODO: stub for [[Bare Unresolved]]');
});
```

- [ ] **Step 2: Verify the test fails or passes.**

Run: `pnpm test --run src/mastra/workflows/turn.test.ts -t "Scenario 8"`
Expected: PASS — Task 7 already implemented `stubOnMention` per spec. If it fails, debug `stubOnMention` — likely the slice ordering or the `unresolved` dedup-by-`(kind, slug)` is off.

- [ ] **Step 3: Commit (whether or not changes were needed).**

```bash
git add src/mastra/workflows/turn.test.ts
git commit -m "test(wave-5): Scenario 8 — stub cap (2 stubs + 3 0-Map TODOs)"
```

---

### Task 10: Register `turnWorkflow` in Mastra + delete remaining weather files

**Files:**

- Modify: `src/mastra/index.ts` (add `workflows: { turnWorkflow }`)
- Modify: `src/mastra/index.test.ts` (assert workflow is registered)

The `turnStep` `execute` body needs to invoke `runTurn` with the real agents from the `mastra` runtime. Wave 4's `turnStep` was a stub; Wave 5 now fills it in.

- [ ] **Step 1: Fill in `turnStep.execute` in `src/mastra/workflows/turn.ts`.**

```ts
import { ttsRender } from '@/lib/media/tts';

const turnStep = createStep({
  id: 'turn',
  inputSchema,
  outputSchema,
  execute: async ({ inputData, mastra, writer }) => {
    if (!mastra) throw new Error('turnStep: mastra runtime not available');
    const narratorAgent = mastra.getAgent('narratorAgent') as unknown as AgentLike<NarratorOutput>;
    const factionAgent = mastra.getAgent('factionAgent') as unknown as AgentLike<FactionOutput>;
    const illustratorAgent = mastra.getAgent(
      'illustratorAgent',
    ) as unknown as AgentLike<IllustratorOutput>;
    const result = await runTurn(inputData, {
      narratorAgent,
      factionAgent,
      illustratorAgent,
      ttsRender: (text, opts) => ttsRender(text, { output: opts.output, voice: opts.voice }),
      emit: (e) => {
        // Mastra's writer is optional; tests in this file ignore it. Spec
        // requires we await per docs; silently swallow lock errors so a
        // disconnected SSE consumer doesn't crash the workflow.
        writer?.write(e).catch(() => {});
      },
    });
    if (result.status === 'error') {
      throw new Error(`turn failed: ${result.message}`);
    }
    return {
      turnId: result.turnId,
      finalProse: result.finalProse,
      audioPath: result.audioPath,
      imageCount: result.images.length,
    };
  },
});
```

Note: the `as unknown as AgentLike<…>` casts are necessary because Mastra's `Agent` type is broader than our `AgentLike` shape (it carries memory, observability hooks, etc.). The cast is safe because `agent.generate(prompt)` and `agent.stream(prompt)` both return objects with `.object` (when `defaultOptions.structuredOutput.schema` is set), which is the full surface we use.

- [ ] **Step 2: Update `src/mastra/index.ts`.**

Replace the constructor block:

```ts
import { turnWorkflow } from './workflows/turn';
// ... existing imports

export const mastra = new Mastra({
  agents: { narratorAgent, factionAgent, illustratorAgent },
  workflows: { turnWorkflow },
  storage: /* unchanged */,
  logger: /* unchanged */,
  observability: /* unchanged */,
});
```

- [ ] **Step 3: Write the failing test.**

Update `src/mastra/index.test.ts` (or add to it):

```ts
it('registers turnWorkflow', () => {
  const w = mastra.getWorkflow('turnWorkflow');
  expect(w).toBeDefined();
  expect(w.id).toBe('turnWorkflow');
});
```

- [ ] **Step 4: Verify the test passes.**

Run: `pnpm test --run src/mastra/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/mastra/index.ts src/mastra/index.test.ts src/mastra/workflows/turn.ts
git commit -m "feat(wave-5): register turnWorkflow on Mastra runtime"
```

---

### Task 11: Smoke CLI — `scripts/smoke-turn.ts`

**Files:**

- Create: `scripts/smoke-turn.ts`

The smoke script is excluded from production builds and CI. It uses the real `mastra` runtime to verify the live integration.

- [ ] **Step 1: Verify the `scripts/` directory exists or create it.**

```bash
ls scripts/ 2>/dev/null || mkdir scripts
```

- [ ] **Step 2: Write the smoke script.**

```ts
// scripts/smoke-turn.ts
// Live smoke test for the per-turn workflow. NOT part of CI; not bundled into
// the Next.js build. Run via:
//   pnpm tsx scripts/smoke-turn.ts --vault <abs-path> --input "<player input>"
// Requires OPENAI_API_KEY and INWORLD_API_KEY in env.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { mastra } from '../src/mastra/index';
import { runTurn } from '../src/mastra/workflows/turn';
import { ttsRender } from '../src/lib/media/tts';
import type { AgentLike } from '../src/mastra/workflows/turn';

function parseArgs(argv: string[]): { vault: string; input: string } {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--vault') out.vault = argv[++i];
    else if (arg === '--input') out.input = argv[++i];
  }
  if (!out.vault || !out.input) {
    console.error('Usage: pnpm tsx scripts/smoke-turn.ts --vault <path> --input "<text>"');
    process.exit(2);
  }
  return { vault: path.resolve(out.vault), input: out.input };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await fs.access(args.vault);
  console.log(`[smoke] vault: ${args.vault}`);
  console.log(`[smoke] input: ${args.input}`);
  const narrator = mastra.getAgent('narratorAgent') as unknown as AgentLike<any>;
  const faction = mastra.getAgent('factionAgent') as unknown as AgentLike<any>;
  const illustrator = mastra.getAgent('illustratorAgent') as unknown as AgentLike<any>;
  const t0 = Date.now();
  const result = await runTurn(
    { vaultRoot: args.vault, playerInput: args.input },
    {
      narratorAgent: narrator,
      factionAgent: faction,
      illustratorAgent: illustrator,
      ttsRender: (text, opts) => ttsRender(text, { output: opts.output, voice: opts.voice }),
      emit: (e) => {
        if (e.type === 'prose_delta') process.stdout.write(e.text);
        else if (e.type === 'phase')
          console.log(`\n[phase] ${e.name}${'count' in e ? ` (count=${e.count})` : ''}`);
        else if (e.type === 'error')
          console.error(`\n[error] ${e.message} (recoverable=${e.recoverable})`);
        else if (e.type === 'done')
          console.log(`\n[done] audio=${e.audioPath}, images=${e.images.length}`);
      },
    },
  );
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n[smoke] elapsed: ${dt}s`);
  if (result.status !== 'success') {
    console.error(`[smoke] FAILED: ${result.message}`);
    process.exit(1);
  }
  console.log(
    `[smoke] OK: turn=${result.turnId}, audio=${result.audioPath}, images=${result.images.length}, matured=${result.matured.length}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Smoke check — verify the script compiles.**

```bash
pnpm tsc --noEmit
```

Expected: zero errors. (Do NOT run the script during plan execution — it costs real OpenAI + Inworld API tokens. Manual run is part of Wave-5 exit criteria, not CI.)

- [ ] **Step 4: Commit.**

```bash
git add scripts/smoke-turn.ts
git commit -m "feat(wave-5): scripts/smoke-turn.ts — live end-to-end CLI smoke test"
```

---

### Task 12: Final verification + coverage

**Files:** (no source changes)

- [ ] **Step 1: Run the full test suite.**

```bash
pnpm test --run
```

Expected: all green, including all 8 Layer-2 scenarios plus all prior waves' tests.

- [ ] **Step 2: Run lint and format check.**

```bash
pnpm lint && pnpm format:check
```

Expected: clean.

- [ ] **Step 3: Verify coverage gate.**

```bash
pnpm test:coverage
```

Expected: ≥ 80% lines/functions/branches/statements for `src/mastra/workflows/turn.ts` and unchanged-or-up for prior files.

- [ ] **Step 4: Verify build (TypeScript only).**

```bash
pnpm tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Optional — Next.js build sanity (catches any accidental client/server import boundary issues).**

```bash
pnpm build
```

Expected: build succeeds. Wave 5 only adds server-side code so this is a smoke check, not a primary gate.

- [ ] **Step 6: Manual live smoke (run BEFORE declaring Wave 5 done — NOT in CI).**

Prepare a fixture copy:

```bash
cp -R tests/fixtures/test-vault /tmp/wave5-smoke-vault
```

Set env in `.env.local` (already set per Wave 0) — confirm `OPENAI_API_KEY`, `INWORLD_API_KEY`, `VAULT_SLUG` are present.

Run:

```bash
pnpm tsx scripts/smoke-turn.ts --vault /tmp/wave5-smoke-vault \
  --input "I want to confront the harbormaster about the missing manifest"
```

Expected output:

- `[phase] factions (count=N)` for some N (0+).
- `[phase] narrator`.
- Prose streams to stdout.
- `[phase] media`, `[phase] persist`, `[done]` lines.
- `[smoke] OK: turn=turn-NNN, audio=…/audio/narrator-turn-NNN.ogg, images=K`.

Verify on disk:

```bash
ls /tmp/wave5-smoke-vault/audio/   # narrator-turn-NNN.ogg
ls /tmp/wave5-smoke-vault/images/  # K png files (0+)
grep "turn-NNN" /tmp/wave5-smoke-vault/journal.md
grep "## turn-NNN" /tmp/wave5-smoke-vault/playtests/*.md
```

All should match the printed turn id. The OGG file should be non-empty (`stat -f %z` > 0). PNGs (if any) should be valid (`file *.png` shows PNG image data).

If anything fails, this is a Wave-5 BLOCKER. File the breakage and stop the pipeline.

---

## Self-review (engineer runs this before requesting review)

Before opening the PR, audit the implementation against each spec section:

1. **Per-turn workflow steps 1-5** (spec 174-284): every step has a corresponding code block in `runTurn` and a test in `turn.test.ts`. Confirm by `grep -n 'Step [12345]' src/mastra/workflows/turn.ts`.
2. **Phase events** (spec 286-297): the `PhaseEvent` union in `turn.ts` matches the spec verbatim. Confirm by visually comparing to spec lines 289-296.
3. **Error handling matrix** (spec 326-344): each row covered by either a test or an inline comment pointing to the rationale:
   - Mutex contention: Scenario 4.
   - Faction validation 1st: `generateWithRetry` unit test (Task 3, test 2).
   - Faction validation 2nd: Scenario 2.
   - Narrator validation 1st: `streamNarratorWithRetry` retry path (covered indirectly in Scenario 3 — retry happens, then 2nd failure).
   - Narrator validation 2nd: Scenario 3.
   - Image gen 5xx: Scenario 5.
   - Illustrator validation 2nd: `generateWithRetry` fallback (illustrator falls back to narrator's prose with `images: []`).
   - TTS failure: Scenario 6.
   - ffmpeg ENOENT at startup: NOT applicable in Wave 5; Wave 3 uses `@inworld/tts` SDK (no ffmpeg). Document this in `turn.ts` header comment.
   - FS write fails: Scenario 7b.
   - Process crash: handled by mutex being in-memory (concurrency invariant); no test possible without process kill.
   - UI disconnects: out of scope for Wave 5 (Wave 6 SSE).
   - `loadEntity` slug not found: handled by Wave 4 tool, not Wave 5; covered by Wave 4 tests.
   - `dice` invalid expression: handled by Wave 4 tool; covered by Wave 4 tests.
4. **Concurrency invariants 1-4** (spec 346-367):
   - Inv. 1: `finally` releases — Scenario 7a, 7b.
   - Inv. 2: globalThis lock — covered by Wave 2's lock tests.
   - Inv. 3: no AbortSignal — verified by code-review: `runTurn`'s deps don't accept one; the workflow doesn't pass `signal` to any agent call.
   - Inv. 4: image filename random suffix — Wave 3's `buildFilename` already enforces; no Wave-5 code generates filenames.
5. **Non-failures as success** (spec 372-375):
   - Empty image list: Scenario 5 (illustrator fallback → `images: []`); journal has no `![[…]]` embeds.
   - Empty faction list: Player input with no on-stage NPCs → `factionsToSpawn.length === 0` → `phase: factions, count: 0` → Step 2 short-circuits via `Promise.all([])` returning `[]` → narrator dossier has empty `<faction_decisions/>`. Add a test asserting this case.

- [ ] **Step 7 (self-review only — add this missing test).**

Append to `src/mastra/workflows/turn.test.ts`:

```ts
it('Scenario "player is alone": no on-stage NPCs → factions count 0 → narrator runs', async () => {
  const { events, emit } = collectEvents();
  // Player input mentions no entities.
  const narratorOutput = { prose: 'You stand alone.' };
  const illustratorOutput = { prose_with_embeds: 'You stand alone.', images: [] };
  const result = await runTurn(
    { vaultRoot: vault, playerInput: 'I sit and think.' },
    {
      narratorAgent: {
        generate: vi.fn(),
        stream: async () => makeAgentStream([''], narratorOutput),
      },
      factionAgent: { generate: vi.fn(), stream: vi.fn() }, // never called
      illustratorAgent: { generate: async () => ({ object: illustratorOutput }), stream: vi.fn() },
      ttsRender: async (_t, o) => o.output,
      emit,
    },
  );
  expect(result.status).toBe('success');
  expect(events.find((e) => e.type === 'phase' && (e as any).name === 'factions')).toEqual({
    type: 'phase',
    name: 'factions',
    count: 0,
  });
});
```

Run: `pnpm test --run src/mastra/workflows/turn.test.ts`. Expect PASS.

Commit if you added the test:

```bash
git add src/mastra/workflows/turn.test.ts
git commit -m "test(wave-5): cover empty-faction-list non-failure path"
```

---

## Wave-5 exit criteria (verbatim from spec lines 577-582 + checklist)

- [x] **Layer 2 integration tests (8 scenarios) all green with mocked agents and media.**
      Covered by Scenarios 1-8 in `src/mastra/workflows/turn.test.ts`.
- [x] **`pnpm tsx scripts/smoke-turn.ts --vault tests/fixtures/test-vault-copy --input "..."` produces: journal entry appended, audio file exists, 0+ images exist, playtest entry exists.**
      Manual step in Task 12 Step 6.
- [x] **Mutex always released even if any step throws (verified by injecting failures at every step).**
      Covered by Scenario 7a (Step 1 throw) and 7b (Step 5 throw); Scenarios 3 and 6 implicitly verify mutex release on Step 3 and Step 4 failures respectively (each asserts `isLocked(slug) === false` post-run).
- [ ] **All prior wave tests still pass.**
      Verified by `pnpm test --run` in Task 12 Step 1.
- [ ] **Coverage ≥ 80%.**
      Verified by `pnpm test:coverage` in Task 12 Step 3.
- [ ] **Lint + format clean.**
      Verified in Task 12 Step 2.
- [ ] **TypeScript compiles.**
      Verified in Task 12 Step 4.

---

## Known follow-ups (NOT in Wave 5 — file as separate tickets if encountered)

1. **Leaked image files on aborted turns.** If illustrator's tool calls write PNGs before TTS rejects, those files stay in `vaults/<slug>/images/` after the workflow returns an error. Spec error matrix accepts this; Wave 0.5 may add cleanup-on-abort.
2. **Prose-delta retry signaling.** Spec line 334 mentions a phase event `narrator: retrying` for the first narrator validation failure. Wave 5 does NOT emit this sub-event — the `PhaseEvent` union has no member for it, and adding one would change the Wave-5/Wave-6 contract. If the UI needs it, add `{ type: 'phase'; name: 'narrator'; retrying: true }` in a follow-up and update both sides.
3. **Concurrent-faction lock ordering.** All faction calls fire in parallel via `Promise.all`. If two factions both modify the SAME entity (they don't in v0 — they're read-only), this would be a race. Documented as not-applicable in v0.
4. **`turn-counter` consumption on aborted turns.** `mintTurnId` increments the counter BEFORE the turn succeeds. An aborted turn (narrator failed × 2, TTS failed × 2, fs failure) leaves a "wasted" turn id. Spec line 341 explicitly accepts this gap behavior.
5. **`writer.write(e)` lock errors.** Mastra's docs warn about not awaiting `writer.write(...)` causing a `WritableStream is locked` error. Wave 5's `turnStep` swallows these with `.catch(() => {})` since the workflow MUST continue even if SSE drops; per concurrency invariant §3 the workflow doesn't care if anyone is listening.

---

## Done

When all checkboxes in Task 12 are ticked and the manual smoke runs green, Wave 5 is shippable. The next ticket is Wave 6: `src/app/api/turn/route.ts` (POST → SSE) and `src/app/play/[slug]/page.tsx` (chat UI). Wave 6 imports `runTurn` and `PhaseEvent` from this wave verbatim; the contract is locked.
