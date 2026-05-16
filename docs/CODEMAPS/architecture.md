<!-- Generated: 2026-05-16 | Files scanned: ~65 | Token estimate: ~950 -->

# Architecture

Single-app **Next.js 16 + Mastra** project (pnpm). Local-only RPG runtime ported from the OpenClaw skill suite — spec: `docs/superpowers/specs/2026-05-10-mastra-rpg-runtime-port-design.md`. Waves 1–6 are merged on `main`; the end-to-end loop (player input → SSE turn → audio + images in browser) is live at `/play/<slug>`.

## Boundaries

```
┌─────────────────────────────────────────────────────────┐
│ Next.js app (src/app)                                   │
│ ├── /play/[slug]/  (chat UI · SSE consumer)  ─┐         │
│ ├── /api/turn          (POST · SSE)           ┼─► Mastra│
│ ├── /api/turn/audio    (GET  audio/ogg)       │         │
│ ├── /api/turn/image    (GET  image/png)       │         │
│ └── /api/chat                                 ─┘ ⚠ stale│
└──────────────────────────────────────────────────┬──────┘
                                                   │
                                                   ▼
                                  ┌─────────────────────────┐
                                  │ Mastra runtime          │
                                  │ src/mastra/             │
                                  │  ├ agents/  narrator    │
                                  │  │           faction    │
                                  │  │           illustrator│
                                  │  ├ tools/   dice        │
                                  │  │          loadEntity  │
                                  │  │          image       │
                                  │  └ workflows/turn       │
                                  └────────────┬────────────┘
                                               │
                       ┌───────────────────────┼────────────────────┐
                       ▼                       ▼                    ▼
                 LibSQL (default)        DuckDB (obs)         Vault (FS)
                 mastra.db               mastra.duckdb        vaults/<slug>/
```

## Layers

| Layer             | Path                | Status                                                                                                                       |
| ----------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| App / UI          | `src/app/`          | `/play/[slug]/` is the live chat surface (Wave 6); root `/` + `/chat/` are starter scaffolds                                 |
| API edge          | `src/app/api/turn/` | Wave-6: `POST /api/turn` (SSE), `GET /api/turn/audio`, `GET /api/turn/image`; `/api/chat` is stale leftover                  |
| SSE module        | `src/lib/sse/`      | Wave-6: serialize/parse/reducer + runner dispatch (mock vs live)                                                             |
| Mastra runtime    | `src/mastra/`       | Wave-4 agents/tools + Wave-5 `workflows/turn.ts` (`runTurn` orchestrator + `turnWorkflow` shell)                             |
| Schemas + dossier | `src/lib/`          | Wave-3: `schemas.ts` (Zod I/O), `dossier.ts` (per-agent prompt assembly), `media/` (OpenAI + Inworld)                        |
| Vault domain lib  | `src/lib/vault/`    | Waves 1+2: parsers (frontmatter, paths, wikilinks, xml, entities) + state (journal, threads, playtests, stubs, turnId, lock) |
| Test fixtures     | `tests/fixtures/`   | `test-vault/` mirrors the vault folder layout                                                                                |
| Live vault        | `vaults/<slug>/`    | `commodore-vex/` (single campaign in v0)                                                                                     |

## Data flow (live — `/play/<slug>` turn)

```
Browser (play-client.tsx)
  │ POST /api/turn { slug, input }
  ▼
src/app/api/turn/route.ts (Zod-validate body, SSE stream)
  │ heartbeat: ': heartbeat\n\n' every 15s
  │ emit → controller.enqueue(serializeEvent(ev))
  ▼
src/lib/sse/runner.ts  (mode dispatch)
  ├─ opts.runner            (test DI)
  ├─ RPG_RUNNER_MOCK === '1' → mockRunTurn
  └─ default                  → liveRunTurn → adaptMastraAgent × 3
                                            └─► runTurn() (src/mastra/workflows/turn.ts)

runTurn(input, deps)        5 steps, mutex held across all of them
  1. lock + dossier prep   mintTurnId · loadAlwaysLoaded · parseRecentEntries · identifyOnStage
     └─ emit {phase: factions, count}
  2. faction fan-out       Promise.all(buildFactionDossier → generateWithRetry)  × N
     └─ emit {phase: narrator}
  3. narrator stream       streamNarratorWithRetry → for-await chunk → emit prose_delta
     └─ emit {phase: media}
  4. illustrator || tts    generateWithRetry || ttsWithRetry  (Promise.all)
     └─ emit {phase: persist}
  5. persist               worldTick? · appendJournal · stubOnMention · appendPlaytest
     └─ emit {done: audioPath, finalProse, images[]}

  catch → emit {error: msg, recoverable}; finally → releaseMutex(slug)

Browser parses SSE chunks → parseSseChunks → reducePhaseEvent → UiState
  prose_delta → state.prose accretes (streaming bubble)
  done        → AudioPlayer + TurnImages rendered
```

## Port wave status

- **Wave-1 (DONE):** vault parsers — `paths`, `frontmatter`, `wikilinks`, `xml`, `entities`.
- **Wave-2 (DONE):** vault writes + state — `journal`, `playtests`, `threads`, `stubs`, `turnId`, `lock`.
- **Wave-3 (DONE, PR #4):** dossier builders, Zod output schemas, media adapters.
- **Wave-4 (DONE, PR #5):** Mastra tools (`dice`, `loadEntity`, `image`), agents (`narrator`, `faction`, `illustrator`).
- **Wave-5 (DONE, PR #7):** `src/mastra/workflows/turn.ts` — `runTurn` orchestrator + `turnWorkflow` Mastra shell + 8 Layer-2 scenarios.
- **Wave-6 (DONE, PR #8):** `POST /api/turn` SSE bridge, `/api/turn/audio` + `/api/turn/image` static serves, `src/lib/sse/` module, `/play/[slug]/` chat UI.

## Concurrency invariants

1. **Per-vault mutex** held from `acquireMutex(slug)` (Step 1) through `releaseMutex(slug)` in the orchestrator's `finally` — locks every code path including failure.
2. **Mutex contention** emits `{error, recoverable:true, message:'still working'}` and returns immediately without entering the 5-step pipeline.
3. **Client disconnect does NOT abort the workflow.** `route.ts` listens for `req.signal.abort` and flips a `clientGone` flag that turns subsequent `emit` calls into no-ops; the runner has no AbortSignal parameter by design (workflow finishes in background).

## Key entry points

- `src/mastra/index.ts` — Mastra instance (agents + workflows)
- `src/mastra/workflows/turn.ts` — `runTurn` orchestrator, `turnWorkflow` shell, `PhaseEvent` contract
- `src/mastra/agents/{narrator,faction,illustrator}.ts` — agent configs with structured output
- `src/mastra/tools/{dice,loadEntity,image}.ts` — `createTool` wrappers
- `src/app/api/turn/route.ts` — SSE bridge (`handleTurnPost` + `POST`)
- `src/app/api/turn/{audio,image}/route.ts` — vault-asset proxies with path-traversal guards
- `src/lib/sse/{events,serialize,parse,reducer,runner}.ts` — wire protocol + UI reducer + mode dispatch
- `src/lib/dossier.ts` — `identifyOnStage` + `build*Dossier` + `extractVisualBlock`
- `src/lib/schemas.ts` — `FactionOutput`, `NarratorOutput`, `IllustratorOutput`, `ImageMeta`
- `src/app/play/[slug]/{page,play-client,phase-tape,mutex-banner,turn-images}.tsx` — chat UI
- `src/app/api/chat/route.ts` — stale starter route (still references removed `weather-agent`); slated for deletion
