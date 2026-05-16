<!-- Generated: 2026-05-16 | Files scanned: ~40 | Token estimate: ~1100 -->

# Backend

Next.js App Router + Mastra in-process runtime. No separate server.

## Routes

| Method | Path              | Handler                               | Status                                                                                |
| ------ | ----------------- | ------------------------------------- | ------------------------------------------------------------------------------------- |
| POST   | `/api/turn`       | `src/app/api/turn/route.ts:POST`      | **Wave-6 live** — Zod-validates `{slug, input}`, streams `PhaseEvent` SSE             |
| GET    | `/api/turn/audio` | `src/app/api/turn/audio/route.ts:GET` | **Wave-6 live** — serves `<vault>/audio/<file>` as `audio/ogg`; path-traversal guard  |
| GET    | `/api/turn/image` | `src/app/api/turn/image/route.ts:GET` | **Wave-6 live** — serves `<vault>/images/<file>` as `image/png`; path-traversal guard |
| POST   | `/api/chat`       | `src/app/api/chat/route.ts:POST`      | **STALE** — references deleted `'weather-agent'`; slated for removal                  |
| GET    | `/api/chat`       | `src/app/api/chat/route.ts:GET`       | **STALE** — same                                                                      |

`THREAD_ID = 'hello-world-thread'` / `RESOURCE_ID = 'hello-world-user'` are leftovers from the starter and live only in the stale `/api/chat` route. The turn workflow has no per-thread memory yet — the journal IS the memory.

### `POST /api/turn` (`src/app/api/turn/route.ts`, ~166 LOC)

```
parseBody (Zod)               → 400 on bad JSON / empty slug / empty input
ReadableStream.start(controller)
  ├─ heartbeat setInterval(15_000ms)         ': heartbeat\n\n'
  ├─ req.signal abort listener              → clientGone = true; clearInterval; safeClose
  ├─ emit = (ev) => safeEnqueue(serializeEvent(ev))     (no-op if clientGone)
  └─ runTurn(parsed, emit, {runner: opts.runner})
       .then(close), .catch(emit {type:'error', recoverable:false}; close)
Response headers: content-type text/event-stream · cache-control no-cache,no-transform
                  · connection keep-alive · x-accel-buffering no
runtime: nodejs · dynamic: force-dynamic
```

The exported `handleTurnPost(req, opts)` is the testable seam — `opts.runner` injects a fake runner so route tests don't touch Mastra. Production `POST` calls it with no opts.

### Static asset routes

Both `audio/route.ts` and `image/route.ts` resolve `<vaultRoot(slug)>/{audio|images}/<filename>`, reject any path that escapes the resolved root, and serve the bytes with a 1-hour `private` cache. No range support in v0.

## SSE module (`src/lib/sse/`)

Wave-5 ↔ Wave-6 wire format + UI helpers. Single import path for both server and client.

| File           | Exports                                         | Notes                                                                              |
| -------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| `events.ts`    | `PhaseEvent` (re-export), `isPhaseEvent`        | Runtime guard — used by parser to drop garbage from the wire                       |
| `serialize.ts` | `serializeEvent`, `serializeHeartbeat`          | `event: <type>\ndata: <json>\n\n` · `: heartbeat\n\n`                              |
| `parse.ts`     | `parseSseChunks(buffer) → {events, rest}`       | Tolerant; splits on `\n\n`, holds partial trailing record, drops malformed records |
| `reducer.ts`   | `UiState`, `initialState`, `reducePhaseEvent`   | Pure reducer for the chat UI — extracted for node-test without jsdom               |
| `runner.ts`    | `runTurn`, `mockRunTurn`, `liveRunTurn`, `Emit` | Three-way dispatch: `opts.runner` > `RPG_RUNNER_MOCK==='1'` > `liveRunTurn`        |

`runner.ts:adaptMastraAgent` is the structural seam between Mastra's concrete `Agent` (whose `generate`/`stream` return rich `FullOutput<T>` / `MastraModelOutput<T>` shapes) and Wave-5's narrow `AgentLike<T>` interface. Also handles `ReadableStream<string>` → `AsyncIterable<string>` for `textStream`.

## Turn workflow (`src/mastra/workflows/turn.ts`, ~573 LOC)

`runTurn(input, deps)` is a single async function (not a chain of `createStep`s) so a single `try/finally` releases the mutex on every code path. The `turnWorkflow = createWorkflow(...).then(turnStep)` shell exists only so Mastra Studio observes the run — its `turnStep` delegates back to `runTurn`.

### `PhaseEvent` contract

```ts
type PhaseEvent =
  | { type: 'phase'; name: 'factions'; count: number }
  | { type: 'phase'; name: 'narrator' }
  | { type: 'prose_delta'; text: string }
  | { type: 'phase'; name: 'media' }
  | { type: 'phase'; name: 'persist' }
  | { type: 'done'; audioPath: string; finalProse: string; images: ImageMeta[] }
  | { type: 'error'; message: string; recoverable: boolean };
```

### Retry policies

| Helper                    | Policy                                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generateWithRetry`       | Faction + illustrator. First call → on throw, append validation error to prompt + retry once → on 2nd fail, fallback.                                                         |
| `streamNarratorWithRetry` | Narrator. Stream attempt 1 (emits `prose_delta`s); 2nd attempt is non-streaming `generate(...)` (zero deltas); 2nd fail → tagged `NARRATOR_FAILED` → recoverable error event. |
| `ttsWithRetry`            | First call; on throw, 200ms backoff + retry; 2nd fail → tagged `TTS_FAILED` → recoverable error event.                                                                        |

Tagged errors (`Symbol.for('wave5.narrator-failed')`, `…tts-failed`) survive across module boundaries.

### Persist step (Step 5)

Only reached on full success of Steps 1–4. Writes: `worldTick` (if `narrator.time_passed`) → `appendJournal(turnId, illustrator.prose_with_embeds)` → `stubOnMention` (max 2 stubs, overflow into `0-Map.md` TODO lines) → `appendPlaytest` (rendered transcript).

## Mastra runtime (`src/mastra/`)

```
index.ts                           Mastra instance (~48 LOC)
 ├─ agents.narratorAgent           → agents/narrator.ts
 ├─ agents.factionAgent            → agents/faction.ts
 ├─ agents.illustratorAgent        → agents/illustrator.ts
 ├─ workflows.turnWorkflow         → workflows/turn.ts (Wave-5)
 ├─ storage: MastraCompositeStore
 │    ├ default: LibSQLStore(file:./mastra.db)
 │    └ domains.observability: DuckDBStore
 ├─ logger: PinoLogger
 └─ observability: DefaultExporter + CloudExporter + SensitiveDataFilter
```

## Agents

| Agent              | id            | Model            | Tools                | Output schema       |
| ------------------ | ------------- | ---------------- | -------------------- | ------------------- |
| `narratorAgent`    | `narrator`    | `openai/gpt-5.5` | `loadEntity`, `dice` | `NarratorOutput`    |
| `factionAgent`     | `faction`     | `openai/gpt-5.5` | (none)               | `FactionOutput`     |
| `illustratorAgent` | `illustrator` | `openai/gpt-5.5` | `image`              | `IllustratorOutput` |

All three: `instructions.providerOptions.openai.reasoningEffort = 'high'`, `defaultOptions.structuredOutput.schema = <ZodSchema>`. System prompts live inline in each `agents/*.ts`.

## Tools (`src/mastra/tools/`)

| Tool         | File            | Input (Zod)                                    | Output (Zod)                                          |
| ------------ | --------------- | ---------------------------------------------- | ----------------------------------------------------- |
| `dice`       | `dice.ts`       | `{ expression: string }`                       | `{ expression, total, rolls[], breakdown }`           |
| `loadEntity` | `loadEntity.ts` | `{ kind: 'npc'\|'faction'\|'location', slug }` | discriminated `{found:true,...} \| {found:false,...}` |
| `image`      | `image.ts`      | `{ prompt, slug }`                             | `ImageMeta` (`{filename, path, prompt, slug}`)        |

## Dossier + schemas (`src/lib/`)

`dossier.ts` (~300 LOC) — prompt-assembly layer consumed by the turn workflow:

```
identifyOnStage(playerInput, recent, entities)        → { npcs, locations, factionsToSpawn }
buildFactionDossier({faction, onStage, recent, world, character, playerInput})    → XML-ish string
buildNarratorDossier({world, character, threads, styleGuide, onStage,
                      recent, factionDecisions, playerInput, turnId})             → XML-ish string
buildIllustratorDossier({narratorProse, styleGuideVisual, onStage})               → XML-ish string
extractVisualBlock(styleGuide)                                                    → string | null
```

On-stage detection: wikilink targets + case-insensitive alias word-boundary match across `playerInput + recent journal`. Faction fan-out keys are the deduped `frontmatter.faction` values of on-stage NPCs (insertion order preserved).

`schemas.ts` exports Zod schemas + inferred TS types under the same name (`FactionOutput`, `NarratorOutput`, `IllustratorOutput`, `ImageMeta`).

## Vault domain library (`src/lib/vault/`)

Pure FS/parsing layer — no Mastra coupling.

```
paths.ts        vaultRoot + every *Path / *Dir helper
frontmatter.ts  parseFrontmatter(raw) → {frontmatter, body}              (gray-matter)
wikilinks.ts    parseWikilinks / resolveWikilink / stripForTts
xml.ts          parseWorldXml / parseThreadsXml / parseCharacterXml      (fast-xml-parser, preserveOrder)
entities.ts     loadNpc / loadFaction / loadLocation / listFactions / loadAlwaysLoaded
journal.ts      parseRecentEntries(root, n) + appendJournal(root, turnId, prose)
playtests.ts    appendPlaytest(root, turnId, body, {today?}) → playtests/<YYYY-MM-DD>.md
stubs.ts        extractExcerpt + createStub({kind, slug, excerptProse}) — kind excludes 'image'
threads.ts      worldTick(root, {days?|hours?}) → MaturedThread[] (atomic tmp+rename rewrite)
turnId.ts       mintTurnId(root) → 'turn-NNN' (atomic counter)
lock.ts         acquireMutex / releaseMutex / isLocked (globalThis-backed, HMR-safe)
```

## Media adapters (`src/lib/media/`)

| Module     | SDK            | Output                                        | Auth              |
| ---------- | -------------- | --------------------------------------------- | ----------------- |
| `image.ts` | `openai`       | PNG → `<vault>/images/<ts>-<slug>-<rand>.png` | `OPENAI_API_KEY`  |
| `tts.ts`   | `@inworld/tts` | OGG Opus file at `options.output`             | `INWORLD_API_KEY` |

`tts.ts` is now wired through the turn workflow (`ttsWithRetry` writes `<vault>/audio/narrator-<turnId>.ogg`). The illustrator agent + tool drive `image.ts` via the `image` tool.

## Key files (LOC)

- `src/mastra/index.ts` (~48 LOC) — Mastra singleton config
- `src/mastra/workflows/turn.ts` (~573 LOC) — runTurn orchestrator + workflow shell
- `src/mastra/agents/{narrator,faction,illustrator}.ts` (~45 each)
- `src/mastra/tools/{dice,loadEntity,image}.ts` (~110 / ~120 / ~70)
- `src/app/api/turn/route.ts` (~166 LOC) — SSE bridge
- `src/app/api/turn/{audio,image}/route.ts` (~45 each) — vault-asset proxies
- `src/lib/sse/runner.ts` (~232 LOC) — mode dispatch + adapter
- `src/lib/sse/{parse,reducer,serialize,events}.ts` (~75 / 75 / 25 / 40)
- `src/lib/dossier.ts` (~300 LOC) — prompt builders
- `src/lib/vault/xml.ts` (~200 LOC) — XML round-trip parsers
- `src/lib/vault/threads.ts` (~100 LOC) — atomic world-tick rewrite

## External services

| Service       | Used by                                                 | Auth                        |
| ------------- | ------------------------------------------------------- | --------------------------- |
| OpenAI Chat   | All three agents (`openai/gpt-5.5`)                     | `OPENAI_API_KEY`            |
| OpenAI Images | `image` tool / `src/lib/media/image.ts` (`gpt-image-2`) | `OPENAI_API_KEY`            |
| Inworld TTS   | `src/lib/media/tts.ts` (model `inworld-tts-2`)          | `INWORLD_API_KEY`           |
| Mastra Cloud  | Studio observability export (optional)                  | `MASTRA_CLOUD_ACCESS_TOKEN` |

## Environment toggles

| Var                 | Effect                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `RPG_RUNNER_MOCK=1` | `runner.ts` dispatches to `mockRunTurn` (deterministic events, no LLM/API cost). Used for local UI dev and tests. |
| `OPENAI_API_KEY`    | Required for agent calls + `image` tool                                                                           |
| `INWORLD_API_KEY`   | Required for narrator audio (`ttsRender`)                                                                         |
| `VAULT_SLUG`        | `loadEntity` + `image` tool default vault root                                                                    |
