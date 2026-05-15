<!-- Generated: 2026-05-15 | Files scanned: ~25 | Token estimate: ~850 -->

# Data

Two persistence surfaces: **Mastra storage** (LibSQL + DuckDB) and the **filesystem vault** (Markdown + XML + state files).

## Mastra storage (composite)

Configured in `src/mastra/index.ts` via `MastraCompositeStore`:

```
default       → LibSQLStore  file:./mastra.db            (threads, messages, agent state, traces)
domains.obs   → DuckDBStore                              (observability spans)
```

Files on disk at repo root:

```
mastra.db          LibSQL (SQLite)  — primary
mastra.db-shm      WAL shared memory
mastra.db-wal      WAL
mastra.duckdb      DuckDB columnar  — observability
mastra.duckdb.wal  DuckDB WAL
```

Tables/relationships are managed by Mastra itself. No app-level migrations.

Thread keys (hardcoded, single-user v0; live in `src/app/api/chat/route.ts` — stale):

- `THREAD_ID = 'hello-world-thread'`
- `RESOURCE_ID = 'hello-world-user'`

## Vault filesystem

A vault is a flat folder at `vaults/<slug>/`. Path helpers in `src/lib/vault/paths.ts`. Live vault: `vaults/commodore-vex/`. Fixture: `tests/fixtures/test-vault/`.

```
vaults/<slug>/
├── world.xml             # WorldView     (parseWorldXml)
├── threads.xml           # ThreadView[]  (parseThreadsXml + worldTick rewrite)
├── character.xml         # CharacterView (parseCharacterXml)
├── 0-Map.md              # zero map (Markdown + frontmatter)
├── style-guide.md        # style guide; ## Visual block fed to illustrator
├── journal.md            # session journal (appendJournal)
├── factions/<slug>.md    # one file per faction
├── npcs/<slug>.md        # one file per NPC
├── locations/<slug>.md   # one file per location
├── images/<filename>.png # illustrator output (gpt-image-2)
├── playtests/<YYYY-MM-DD>.md  # per-day raw turn log (appendPlaytest)
└── .turn-counter         # monotonic counter; mintTurnId() reads/writes atomically
```

Per-vault in-process mutex (`src/lib/vault/lock.ts`) sits on `globalThis` so Next.js HMR doesn't drop held state. Contention returns `false` (rejected, not queued). Not durable across crashes.

## Markdown contract

Each entity file: YAML frontmatter + body, parsed by `parseFrontmatter` (gray-matter).

```yaml
---
name: ...
tags: [...] # 'npc', 'location', or 'faction'; plus 'stub' for auto-created stubs
aliases: [...]
faction: <slug> # NPCs only
---
Body in Markdown, may contain wikilinks [[npcs/foo|Foo]] or embeds ![[file.png]].
```

## Wikilink resolution (v0: folder-prefix-or-bust)

`src/lib/vault/wikilinks.ts`

- `[[npcs/slug]]`, `[[locations/slug]]`, `[[factions/slug]]` → resolved by kind
- `[[bare]]` → defaults to `kind=npc`, `found=false` (stub candidate)
- `![[file.png]]` → image embed, dropped by `stripForTts`
- Alias precedence handled by `stripForTts` (alias wins, else deslug, else verbatim)
- `Kind` type union covers `'npc' | 'faction' | 'location' | 'image'`; `createStub` excludes `'image'` at the type level.

## XML round-trip

`src/lib/vault/xml.ts` uses `fast-xml-parser` with `preserveOrder: true`, `trimValues: false`, `format: false` — writes byte-identical to reads. `threads.ts` `worldTick` operates on the raw XML via regex so unrelated whitespace stays untouched.

## Agent / tool schemas (`src/lib/schemas.ts`)

```ts
FactionOutput     = { decision: string; reasoning: string }
NarratorOutput    = { prose: string; time_passed?: { days?: number; hours?: number } }
ImageMeta         = { filename: string; path: string; prompt: string; slug: string }
IllustratorOutput = { prose_with_embeds: string; images: ImageMeta[] }
```

Each export is BOTH a Zod schema (runtime value) and a TS type alias inferred via `z.infer<typeof …>` under the same name. Use the value in `outputSchema:` / runtime checks; use the type in `Promise<…>` / variable types.

## On-stage detection input shape

`identifyOnStage` consumes `{ playerInput, recent: JournalEntry[], entities: EntityDoc[] }` and returns `{ npcs, locations, factionsToSpawn[] }`. NPCs/locations are filtered by wikilink targets in player input + recent journal, OR case-insensitive alias word-boundary match. `factionsToSpawn` is the deduped insertion-ordered list of on-stage NPCs' `frontmatter.faction`.

## Turn lifecycle (Wave 5 target — not yet implemented)

```
mintTurnId(root)              → "turn-NNN"
parseRecentEntries(root, n)   → JournalEntry[]
identifyOnStage(...)          → OnStage
buildFactionDossier × N       → faction.generate(...)        → FactionOutput
buildNarratorDossier          → narrator.generate(...)       → NarratorOutput
  └─ tool: dice                                              → DiceResult
  └─ tool: loadEntity                                        → LoadEntityResult
buildIllustratorDossier       → illustrator.generate(...)    → IllustratorOutput
  └─ tool: image (0-3 calls)                                 → ImageMeta
appendJournal(root, turnId, illustrator.prose_with_embeds)
appendPlaytest(root, turnId, <raw transcript>)
if (narrator.time_passed) worldTick(root, narrator.time_passed) → MaturedThread[]
```

## Migration history

None — Mastra owns its schema. The vault format is the spec contract (preserved from OpenClaw skill suite).
