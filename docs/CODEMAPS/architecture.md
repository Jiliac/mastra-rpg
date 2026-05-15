<!-- Generated: 2026-05-15 | Files scanned: ~50 | Token estimate: ~850 -->

# Architecture

Single-app **Next.js 16 + Mastra** project (pnpm). Local-only RPG runtime ported from the OpenClaw skill suite — spec: `docs/superpowers/specs/2026-05-10-mastra-rpg-runtime-port-design.md`. Waves 1–4 are merged on `main`; Wave 5 (workflow) is the next ticket.

## Boundaries

```
┌──────────────────────────────────────────────┐
│ Next.js app (src/app)                        │
│ ├── Player UI (chat/, page.tsx)  ─┐          │
│ └── API routes (api/chat)        ─┼─► Mastra │
└────────────────────────────────────┴─────────┘
                                       │
                                       ▼
                         ┌─────────────────────────┐
                         │ Mastra runtime          │
                         │ src/mastra/             │
                         │  ├ agents/  narrator    │
                         │  │           faction    │
                         │  │           illustrator│
                         │  └ tools/   dice        │
                         │             loadEntity  │
                         │             image       │
                         └────────────┬────────────┘
                                      │
              ┌───────────────────────┼────────────────────┐
              ▼                       ▼                    ▼
        LibSQL (default)        DuckDB (obs)         Vault (FS)
        mastra.db               mastra.duckdb        vaults/<slug>/
```

The narrator's prompt mentions the three agents acting together; the workflow that orchestrates them (faction fan-out → narrator → illustrator → journal/playtest/world-tick) is **not yet implemented** — Wave 5.

## Layers

| Layer             | Path              | Status                                                                                                                       |
| ----------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| App / UI          | `src/app/`        | Demo scaffold; `chat/page.tsx` still posts to `/api/chat`                                                                    |
| API edge          | `src/app/api/`    | `POST/GET /api/chat` (stream + history) — **stale: references deleted `weather-agent`**                                      |
| Mastra runtime    | `src/mastra/`     | Wave-4: narrator/faction/illustrator agents + dice/image/loadEntity tools                                                    |
| Schemas + dossier | `src/lib/`        | Wave-3: `schemas.ts` (Zod I/O), `dossier.ts` (per-agent prompt assembly), `media/` (OpenAI + Inworld)                        |
| Vault domain lib  | `src/lib/vault/`  | Waves 1+2: parsers (frontmatter, paths, wikilinks, xml, entities) + state (journal, threads, playtests, stubs, turnId, lock) |
| Test fixtures     | `tests/fixtures/` | `test-vault/` mirrors the vault folder layout                                                                                |
| Live vault        | `vaults/<slug>/`  | `commodore-vex/` (single campaign in v0)                                                                                     |

## Data flow (current — chat route, pre-Wave-5)

```
Browser useChat() ──► POST /api/chat ──► handleChatStream({mastra, agentId:'weather-agent'})
                                              │   ▲
                                              │   └── DANGLING: weather-agent no longer registered
                                              ▼
                                          (would fail at runtime)
        ◄── SSE UIMessageStream ◄────────────┘
```

## Data flow (target — turn workflow, Wave 5+)

```
POST /api/turn (TBD)
   └─► turnWorkflow(playerInput, vaultSlug)
        ├─ vault.load AlwaysLoaded + recent journal
        ├─ identifyOnStage()  → npcs[], locations[], factionsToSpawn[]
        ├─ parallel: faction.generate(buildFactionDossier(...))    × N
        ├─ narrator.generate(buildNarratorDossier(...))            → { prose, time_passed? }
        ├─ illustrator.generate(buildIllustratorDossier(...))      → { prose_with_embeds, images[] }
        ├─ writes: appendJournal, appendPlaytest, worldTick (if time_passed)
        └─ SSE: stream prose + image events back to UI
```

## Port wave status

- **Wave-1 (DONE):** vault parsers — `paths`, `frontmatter`, `wikilinks`, `xml`, `entities`.
- **Wave-2 (DONE):** vault writes + state — `journal`, `playtests`, `threads`, `stubs`, `turnId`, `lock`.
- **Wave-3 (DONE, PR #4):** dossier builders (`src/lib/dossier.ts`), Zod output schemas (`src/lib/schemas.ts`), media adapters (`src/lib/media/{image,tts}.ts`).
- **Wave-4 (DONE, PR #5):** Mastra tools (`dice`, `loadEntity`, `image`), agents (`narrator`, `faction`, `illustrator`), registration in `src/mastra/index.ts`. Weather agent/workflow removed.
- **Wave-5 (NEXT):** `src/mastra/workflows/turn.ts` + `/api/turn` SSE route. Until then `/api/chat` is dead code referencing a removed agent.

## Key entry points

- `src/mastra/index.ts` — Mastra instance (agents only; `workflows` key intentionally omitted)
- `src/mastra/agents/{narrator,faction,illustrator}.ts` — agent configs with structured output
- `src/mastra/tools/{dice,loadEntity,image}.ts` — `createTool` wrappers
- `src/lib/dossier.ts` — `identifyOnStage`, `buildFactionDossier`, `buildNarratorDossier`, `buildIllustratorDossier`, `extractVisualBlock`
- `src/lib/schemas.ts` — `FactionOutput`, `NarratorOutput`, `IllustratorOutput`, `ImageMeta`
- `src/app/api/chat/route.ts` — SSE chat bridge (stale; will be replaced by `/api/turn` in Wave 5)
- `src/app/layout.tsx` / `src/app/page.tsx` / `src/app/chat/page.tsx` — Next App Router shell
