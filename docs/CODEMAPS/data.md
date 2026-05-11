<!-- Generated: 2026-05-11 | Files scanned: ~15 | Token estimate: ~600 -->

# Data

Two persistence surfaces: **Mastra storage** (LibSQL + DuckDB) and the **filesystem vault** (Markdown + XML).

## Mastra storage (composite)

Configured in `src/mastra/index.ts` via `MastraCompositeStore`:

```
default       → LibSQLStore  file:./mastra.db            (threads, messages, workflow state)
domains.obs   → DuckDBStore                              (observability/traces)
```

Files on disk:

```
mastra.db          LibSQL (SQLite)  — primary
mastra.db-shm      WAL shared memory
mastra.db-wal      WAL
mastra.duckdb      DuckDB columnar  — observability traces
mastra.duckdb.wal  DuckDB WAL
```

Tables/relationships are managed by Mastra itself (threads, messages, workflow runs, traces). No app-level migrations.

Thread keys (hardcoded v0):

- `THREAD_ID = 'hello-world-thread'`
- `RESOURCE_ID = 'hello-world-user'`

## Vault filesystem

A vault is a flat folder at `vaults/<slug>/`. Path helpers in `src/lib/vault/paths.ts`.

```
vaults/<slug>/
├── world.xml          # WorldView   (parseWorldXml)
├── threads.xml        # ThreadView[] (parseThreadsXml)
├── character.xml      # CharacterView (parseCharacterXml)
├── 0-Map.md           # zero map (Markdown + frontmatter)
├── style-guide.md     # style guide
├── journal.md         # session journal
├── factions/<slug>.md # one file per faction
├── npcs/<slug>.md     # one file per NPC
└── locations/<slug>.md
```

Live vault: `vaults/commodore-vex/` (single campaign in v0).
Test fixture: `tests/fixtures/test-vault/` (mirrors structure).

## Markdown contract

Each entity file: YAML frontmatter + body, parsed by `parseFrontmatter` (gray-matter).

```yaml
---
name: ...
tags: [...]
aliases: [...]
---
Body in Markdown, may contain wikilinks [[npcs/foo|Foo]] or embeds ![[img]].
```

## Wikilink resolution (v0: folder-prefix-or-bust)

`src/lib/vault/wikilinks.ts`

- `[[npcs/slug]]`, `[[locations/slug]]`, `[[factions/slug]]` → resolved
- `[[bare]]` → defaults to `kind=npc`, `found=false` (stub candidate)
- `![[…]]` → embed (image), dropped by `stripForTts`
- Alias precedence handled by `stripForTts` (alias wins, else deslug, else verbatim)

## XML round-trip

`src/lib/vault/xml.ts` uses `fast-xml-parser` with `preserveOrder: true`, `trimValues: false`, `format: false` so writes are whitespace-identical to reads.

## Migration history

None — Mastra owns its schema. Vault format is the spec contract (preserved from OpenClaw skill suite).
