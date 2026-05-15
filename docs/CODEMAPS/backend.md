<!-- Generated: 2026-05-15 | Files scanned: ~30 | Token estimate: ~950 -->

# Backend

Next.js App Router + Mastra in-process runtime. No separate server.

## Routes

| Method | Path        | Handler                          | Status                                                                     |
| ------ | ----------- | -------------------------------- | -------------------------------------------------------------------------- |
| POST   | `/api/chat` | `src/app/api/chat/route.ts:POST` | **STALE** — references deleted `'weather-agent'`; will 500 on call         |
| GET    | `/api/chat` | `src/app/api/chat/route.ts:GET`  | **STALE** — same; `mastra.getAgentById('weather-agent')` returns undefined |

The chat route is left over from the starter and is dead code now that the weather agent is gone. Wave 5 replaces it with `POST /api/turn` driving the turn workflow.

```
POST /api/chat → handleChatStream({mastra, agentId:'weather-agent', ...})   ← broken
GET  /api/chat → mastra.getAgentById('weather-agent').getMemory().recall   ← broken
```

`THREAD_ID = 'hello-world-thread'` and `RESOURCE_ID = 'hello-world-user'` are hardcoded constants (single-user v0 model).

## Mastra runtime (`src/mastra/`)

```
index.ts                           Mastra instance — see registration table below
 ├─ agents.narratorAgent           → agents/narrator.ts
 ├─ agents.factionAgent            → agents/faction.ts
 ├─ agents.illustratorAgent        → agents/illustrator.ts
 ├─ storage: MastraCompositeStore
 │    ├ default: LibSQLStore(file:./mastra.db)
 │    └ domains.observability: DuckDBStore
 ├─ logger: PinoLogger
 └─ observability: DefaultExporter + CloudExporter + SensitiveDataFilter
```

`workflows` is intentionally omitted from the Mastra config (would be `{}`); Wave 5 will add `turnWorkflow`.

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

- `dice` is a pure parser/roller; grammar: `NdM[±K]`, `pbta[±K]`, `advantage`, `disadvantage`. Caps `N≤100`, `M≤1000` to prevent prompt-driven DoS. Throws on invalid input — agent retry contract.
- `loadEntity` wraps Wave-1 loaders; ENOENT → `{found:false}`, any other error rethrows. Vault root from `process.env.VAULT_SLUG` unless `deps.vaultRoot` overrides.
- `image` adapts `src/lib/media/image.ts` (OpenAI `gpt-image-2`, quality `'high'`) and writes under `<vault>/images/`.

## Dossier + schemas (`src/lib/`)

`dossier.ts` (~300 LOC) is the prompt-assembly layer for Wave 5's workflow:

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

Pure FS/parsing layer — no Mastra coupling. Wave-1 reads, Wave-2 writes & state.

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

`loadAlwaysLoaded(root)` parallel-loads `WorldView`, `CharacterView`, `ThreadView[]`, zero-map, style-guide, and all factions — the "always-loaded" bundle the GM workflow will pass into every dossier.

## Media adapters (`src/lib/media/`)

| Module     | SDK            | Output                                        | Auth              |
| ---------- | -------------- | --------------------------------------------- | ----------------- |
| `image.ts` | `openai`       | PNG → `<vault>/images/<ts>-<slug>-<rand>.png` | `OPENAI_API_KEY`  |
| `tts.ts`   | `@inworld/tts` | OGG Opus file at `options.output`             | `INWORLD_API_KEY` |

Both modules expose dependency-injection seams (`deps.openai` / `deps.inworld`) typed against minimal structural interfaces (`OpenAILike`, `InworldTtsLike`) so tests stub them without touching the network. `tts.ts` is wired into media generation but **not yet referenced by any agent or tool** — reserved for future narration playback.

## Key files (LOC)

- `src/mastra/index.ts` (~48 LOC) — Mastra singleton config
- `src/mastra/agents/{narrator,faction,illustrator}.ts` (~45 each)
- `src/mastra/tools/{dice,loadEntity,image}.ts` (~110 / ~120 / ~70)
- `src/app/api/chat/route.ts` (~43 LOC) — stale, removable after Wave 5
- `src/lib/dossier.ts` (~300 LOC) — prompt builders
- `src/lib/vault/xml.ts` (~200 LOC) — XML round-trip parsers
- `src/lib/vault/threads.ts` (~100 LOC) — atomic world-tick rewrite

## External services

| Service       | Used by                                                       | Auth                        |
| ------------- | ------------------------------------------------------------- | --------------------------- |
| OpenAI Chat   | All three agents (`openai/gpt-5.5`)                           | `OPENAI_API_KEY`            |
| OpenAI Images | `image` tool / `src/lib/media/image.ts` (`gpt-image-2`)       | `OPENAI_API_KEY`            |
| Inworld TTS   | `src/lib/media/tts.ts` (model `inworld-tts-2`, not yet wired) | `INWORLD_API_KEY`           |
| Mastra Cloud  | Studio observability export (optional)                        | `MASTRA_CLOUD_ACCESS_TOKEN` |
