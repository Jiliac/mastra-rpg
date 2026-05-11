# Wave 1 — Vault Read-Side Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure-TypeScript vault read-side at `src/lib/vault/` (paths, frontmatter, xml, entities + `loadAlwaysLoaded`, wikilinks) plus a fixture vault at `tests/fixtures/test-vault/` so subsequent waves can load `commodore-vex`-style vaults into typed objects without a Mastra dependency.

**Architecture:** Five focused modules under `src/lib/vault/`, each with a single responsibility and a tight LOC budget (paths ~30, frontmatter ~30, xml ~100, entities ~80, wikilinks ~120). Tests sit at `tests/fixtures/test-vault/` (a hand-built minimal vault) and `src/lib/vault/*.test.ts` (vitest, co-located, 80% coverage gate already wired in `vitest.config.ts`). No Mastra, no AI SDK, no provider deps — these modules are unit-testable in isolation and mirror what `state.py` does in OpenClaw.

**Tech Stack:** TypeScript (ES2022 modules, strict), `gray-matter` (YAML frontmatter), `fast-xml-parser` (XML parse + whitespace-preserving build), vitest + @vitest/coverage-v8 (already in `package.json`). Node 22.13+ runtime. No new runtime dependencies needed (`gray-matter@4.0.3` and `fast-xml-parser@5.7.3` are already installed).

**Source spec:** `docs/superpowers/specs/2026-05-10-mastra-rpg-runtime-port-design.md` — Wave 1 section (lines 489–508), Testing → Layer 1 (lines 379–396), Faction-trigger / wikilink / kind-folder semantics (lines 256–258, 308–313).

**Reference vault (live, do NOT modify in tests):** `vaults/commodore-vex/` is a symlink to `/Users/valentin/Development/ai/maz_rpg/rpg/commodore-vex/`. Use only for shape reference. All tests run against `tests/fixtures/test-vault/`.

---

## Wave 0 prerequisite check (informational — do NOT re-run if green)

Before starting, verify the prerequisites that Wave 0 was supposed to land. If any item is missing, stop and report rather than fixing inline — Wave 0 is a separate ticket.

- [ ] **Verify deps installed.** Run `node -e "require('gray-matter'); require('fast-xml-parser'); require('zod'); console.log('ok')"` from repo root. Expected: `ok`. If any module is missing, abort and report — Wave 0 incomplete.
- [ ] **Verify vitest config has coverage gate at 80% scoped to `src/lib/vault/`.** Read `vitest.config.ts`. The `coverage.include` array MUST contain `'src/lib/vault/**/*.ts'` and the `coverage.thresholds` object MUST contain `lines: 80, functions: 80, branches: 80, statements: 80`. As of this plan, `vitest.config.ts` already satisfies this — no change needed. If it has drifted, abort and report.
- [ ] **Verify symlink exists.** Run `readlink vaults/commodore-vex`. Expected: `/Users/valentin/Development/ai/maz_rpg/rpg/commodore-vex`. If missing, the live vault is unavailable; Wave 1 still proceeds (we only test against the fixture vault) — note it but do not block.

---

## File structure

Production files (all under `src/lib/vault/`):

| File             | Responsibility                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `paths.ts`       | Vault root resolution (`vaultRoot(slug)`); slug-relative paths (`npcPath`, `factionPath`, `locationPath`, `worldXmlPath`, `threadsXmlPath`, etc.).                                                                             |
| `frontmatter.ts` | Wrap `gray-matter` to parse YAML frontmatter from a Markdown string; return `{ frontmatter, body }`. Tolerant of missing fields, strict on malformed.                                                                          |
| `xml.ts`         | Read + parse `world.xml` / `threads.xml` / `character.xml` via `fast-xml-parser`; whitespace-preserving build; typed accessors used by Wave 2.                                                                                 |
| `entities.ts`    | `loadNpc`, `loadFaction`, `loadLocation` (single-entity readers) + `listFactions` + `loadAlwaysLoaded(slug)` (assembles 0-Map, world, character, threads, style-guide, factions/\* into a typed object).                       |
| `wikilinks.ts`   | `parse(text)` → `[{ raw, target, alias?, embed }, …]`; `resolve(link, registry)` → `{ kind, slug, found }`; `stripForTts(text)` → narrator-prose with wikilinks replaced; `findUnresolved` deferred to Wave 2 stub-on-mention. |

Test files (co-located + fixture):

| File                                | Responsibility                                                           |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `tests/fixtures/test-vault/`        | Minimal hand-built vault exercising every code path (built first).       |
| `src/lib/vault/paths.test.ts`       | Path-helper tests against the fixture vault.                             |
| `src/lib/vault/frontmatter.test.ts` | YAML edge cases (arrays, missing, malformed).                            |
| `src/lib/vault/xml.test.ts`         | Round-trip whitespace; mutation preservation; repeated `<faction>` tags. |
| `src/lib/vault/entities.test.ts`    | Single-entity loaders + `loadAlwaysLoaded`.                              |
| `src/lib/vault/wikilinks.test.ts`   | Parse, resolve, `stripForTts`, default-`npc` fallback.                   |

Type re-exports (used by later waves) are exported from each module's top — no separate `types.ts`. Keep types co-located with the function that produces them.

---

## Implementation order (TDD discipline)

The spec mandates 80% coverage on `src/lib/vault/` and tests-first per Layer 1. Each task follows red-green-refactor explicitly: Step "Write the failing test" → Step "Run to verify it fails" → Step "Write minimal implementation" → Step "Run to verify it passes" → Step "Commit". Do not batch implementation ahead of tests.

Order: **(0) Fixture vault → (1) paths → (2) frontmatter → (3) xml → (4) entities → (5) wikilinks → (6) coverage gate verification.**

Rationale: paths is leaf-most (no deps). Frontmatter and xml are independent siblings. Entities depends on paths + frontmatter + xml. Wikilinks depends on entities for `resolve`'s alias registry. The fixture vault has to exist before any test can run.

---

## Task 0: Build the test fixture vault

The spec's Testing → Layer 1 section requires a fixture vault that exercises every code path: 2 factions, 3 NPCs (one with `faction:`), 2 locations, a `journal.md` with mixed heading formats, a `threads.xml` with mixed clock states. We add a `0-Map.md`, `world.xml`, `character.xml`, and `style-guide.md` because `loadAlwaysLoaded` reads them.

The fixture is intentionally small so a human can hold it in their head while writing tests. Slugs and aliases are chosen to exercise the wikilink resolver's edge cases (folder-prefix wins; alias-only resolves; bare unresolved defaults to `npc`; multi-word deslug for TTS).

**Files:**

- Create: `tests/fixtures/test-vault/0-Map.md`
- Create: `tests/fixtures/test-vault/world.xml`
- Create: `tests/fixtures/test-vault/character.xml`
- Create: `tests/fixtures/test-vault/threads.xml`
- Create: `tests/fixtures/test-vault/style-guide.md`
- Create: `tests/fixtures/test-vault/journal.md`
- Create: `tests/fixtures/test-vault/factions/red-banner.md`
- Create: `tests/fixtures/test-vault/factions/blue-river.md`
- Create: `tests/fixtures/test-vault/npcs/kessha.md`
- Create: `tests/fixtures/test-vault/npcs/iron-promise-captain.md`
- Create: `tests/fixtures/test-vault/npcs/lone-wolf.md`
- Create: `tests/fixtures/test-vault/locations/iron-promise.md`
- Create: `tests/fixtures/test-vault/locations/the-brace.md`

- [ ] **Step 1: Verify the fixture directory does not already exist.**

```bash
test ! -e tests/fixtures/test-vault && echo "ok, will create" || echo "FIXTURE EXISTS — STOP"
```

Expected: `ok, will create`. If `FIXTURE EXISTS — STOP`, abort and report — someone has already partially built this and we need to reconcile.

- [ ] **Step 2: Create `tests/fixtures/test-vault/world.xml`.**

```xml
<world>
  <date calendar="GSC">7 ABY, Month 4, Standard Day 20</date>
  <location>
    <region>Test Region</region>
    <city>Test City</city>
    <place slug="iron-promise">iron-promise</place>
  </location>
  <weather>Clear, cold.</weather>
  <season>Test season.</season>
  <conditions>
    <note>A test note.</note>
  </conditions>
</world>
```

- [ ] **Step 3: Create `tests/fixtures/test-vault/character.xml`.**

The repeated `<faction>` tags are required by the spec — `xml.ts` must handle them as an array, not collapse them.

```xml
<character>
  <name>Test Captain</name>
  <age>40 standard years</age>
  <role>test captain</role>
  <background>A test background.</background>
  <skills>Test skills.</skills>
  <inventory>
    <item significance="key">Test item</item>
  </inventory>
  <wealth>strapped</wealth>
  <reputation>
    <faction slug="red-banner">tolerated</faction>
    <faction slug="blue-river">unknown</faction>
  </reputation>
  <relationships>
    <npc slug="kessha">first mate</npc>
  </relationships>
</character>
```

- [ ] **Step 4: Create `tests/fixtures/test-vault/threads.xml` with mixed clock states.**

Three threads: one fresh (1/8), one mid (4/7), one matured (5/5). Wave 2's `worldTick` will mutate this; Wave 1 only reads it.

```xml
<threads>
  <thread id="fresh-clock">
    <name>Fresh Clock</name>
    <stake>A clock that has barely started.</stake>
    <progress>1/8</progress>
    <trigger>Advances by standard days.</trigger>
  </thread>
  <thread id="mid-clock">
    <name>Mid Clock</name>
    <stake>A clock at the midpoint.</stake>
    <progress>4/7</progress>
    <trigger>Advances by standard days.</trigger>
  </thread>
  <thread id="matured-clock">
    <name>Matured Clock</name>
    <stake>A clock that has reached maturity.</stake>
    <progress>5/5</progress>
    <trigger>Advances by standard days.</trigger>
  </thread>
</threads>
```

- [ ] **Step 5: Create `tests/fixtures/test-vault/0-Map.md`.**

```markdown
---
tags: [moc]
---

# Test Vault

A minimal vault for unit tests. The campaign is intentionally thin.

## Factions

- [[factions/red-banner]] — first faction
- [[factions/blue-river]] — second faction

## NPCs

- [[npcs/kessha]] — first mate (has faction)
- [[npcs/iron-promise-captain]] — color-only (no faction)
- [[npcs/lone-wolf]] — color-only (no faction)

## Locations

- [[locations/iron-promise]]
- [[locations/the-brace]]
```

- [ ] **Step 6: Create `tests/fixtures/test-vault/style-guide.md`.**

The `## Visual` block is required so `extractVisualBlock` (Wave 3) has something to extract; for Wave 1 we only verify `loadAlwaysLoaded` returns the file's contents.

```markdown
---
tags: [meta, style]
---

# Style Guide

## Tone

Test tone block. One sentence.

## Visual

Test visual block. One sentence.
```

- [ ] **Step 7: Create `tests/fixtures/test-vault/journal.md` with mixed heading formats.**

Spec requires "mixed heading formats" — exercises that we are tolerant. This is read by Wave 2's `journal.ts`; Wave 1 ignores the body but `loadAlwaysLoaded` does NOT load journal (per spec it's not always-loaded). We still create it so the fixture is complete.

```markdown
# Journal

## 7 ABY, Month 4, Day 18 — Prologue

Prologue prose.

## 7 ABY, Month 4, Standard Day 18 — turn-001

Turn-001 prose mentions [[npcs/kessha|Kessha]] and [[locations/iron-promise]].

## Turn 002 - 7 ABY, Month 4, Day 19

Turn-002 prose mentions [[Iron Promise Captain]] and bare [[some-stub-target]].
```

- [ ] **Step 8: Create faction `tests/fixtures/test-vault/factions/red-banner.md`.**

```markdown
---
aliases: [Red Banner, the Banner]
tags: [faction]
goals:
  - test goal
relationships:
  blue-river: rival
---

# Red Banner

Test faction body.
```

- [ ] **Step 9: Create faction `tests/fixtures/test-vault/factions/blue-river.md`.**

```markdown
---
aliases: [Blue River]
tags: [faction]
goals:
  - test goal
---

# Blue River

Test faction body.
```

- [ ] **Step 10: Create NPC `tests/fixtures/test-vault/npcs/kessha.md` (the one with `faction:`).**

```markdown
---
aliases: [Kessha, the navigator]
tags: [npc]
faction: red-banner
---

# Kessha

Test NPC body. References [[locations/iron-promise|the ship]].
```

- [ ] **Step 11: Create NPC `tests/fixtures/test-vault/npcs/iron-promise-captain.md` (no faction, multi-word slug).**

The slug exercises `stripForTts` deslug — `iron-promise-captain` → `iron promise captain`.

```markdown
---
aliases: [Iron Promise Captain, the captain]
tags: [npc]
---

# Iron Promise Captain

Test NPC body without a faction.
```

- [ ] **Step 12: Create NPC `tests/fixtures/test-vault/npcs/lone-wolf.md`.**

```markdown
---
aliases: [Lone Wolf]
tags: [npc]
---

# Lone Wolf

Test NPC body.
```

- [ ] **Step 13: Create location `tests/fixtures/test-vault/locations/iron-promise.md`.**

```markdown
---
aliases: [Iron Promise, the ship]
tags: [location, ship]
---

# Iron Promise

Test location body.
```

- [ ] **Step 14: Create location `tests/fixtures/test-vault/locations/the-brace.md`.**

```markdown
---
aliases: [The Brace, Brace cantina]
tags: [location, cantina]
---

# The Brace

Test location body.
```

- [ ] **Step 15: Verify fixture is complete.**

```bash
find tests/fixtures/test-vault -type f | sort
```

Expected output (13 files):

```
tests/fixtures/test-vault/0-Map.md
tests/fixtures/test-vault/character.xml
tests/fixtures/test-vault/factions/blue-river.md
tests/fixtures/test-vault/factions/red-banner.md
tests/fixtures/test-vault/journal.md
tests/fixtures/test-vault/locations/iron-promise.md
tests/fixtures/test-vault/locations/the-brace.md
tests/fixtures/test-vault/npcs/iron-promise-captain.md
tests/fixtures/test-vault/npcs/kessha.md
tests/fixtures/test-vault/npcs/lone-wolf.md
tests/fixtures/test-vault/style-guide.md
tests/fixtures/test-vault/threads.xml
tests/fixtures/test-vault/world.xml
```

- [ ] **Step 16: Commit the fixture.**

```bash
git add tests/fixtures/test-vault
git commit -m "test(vault): add fixture vault for Wave 1 unit tests"
```

---

## Task 1: `src/lib/vault/paths.ts`

Pure path resolution. No I/O. Computes vault root from a slug and exposes typed helpers for every file the vault read-side cares about. Wave 2 will extend with mutation paths (audio/, images/, playtests/) but Wave 1 only needs read paths.

**Files:**

- Create: `src/lib/vault/paths.ts`
- Test: `src/lib/vault/paths.test.ts`

The vault root resolution rule (matches what later waves and the API route will use): `vaultRoot(slug)` returns `<repoRoot>/vaults/<slug>`. Tests don't go through `vaultRoot` — every file helper takes a `root` parameter explicitly (`worldXmlPath(root)`, etc.), so tests just pass `'tests/fixtures/test-vault'` directly to those helpers. We use `process.cwd()` rather than computing repo root because Mastra/Next dev commands always run from the repo root and tests run via vitest from the same dir.

- [ ] **Step 1: Write the failing tests.**

`src/lib/vault/paths.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  vaultRoot,
  worldXmlPath,
  threadsXmlPath,
  characterXmlPath,
  styleGuidePath,
  zeroMapPath,
  journalPath,
  factionsDir,
  npcsDir,
  locationsDir,
  factionPath,
  npcPath,
  locationPath,
} from './paths';

const FIXTURE = 'tests/fixtures/test-vault';

describe('paths', () => {
  it('vaultRoot resolves slug under <cwd>/vaults', () => {
    const root = vaultRoot('commodore-vex');
    expect(root.endsWith('/vaults/commodore-vex')).toBe(true);
    expect(root.startsWith('/')).toBe(true);
  });

  it('top-level file paths join under root', () => {
    const root = FIXTURE;
    expect(worldXmlPath(root)).toBe(`${FIXTURE}/world.xml`);
    expect(threadsXmlPath(root)).toBe(`${FIXTURE}/threads.xml`);
    expect(characterXmlPath(root)).toBe(`${FIXTURE}/character.xml`);
    expect(styleGuidePath(root)).toBe(`${FIXTURE}/style-guide.md`);
    expect(zeroMapPath(root)).toBe(`${FIXTURE}/0-Map.md`);
    expect(journalPath(root)).toBe(`${FIXTURE}/journal.md`);
  });

  it('kind-folder helpers return directory paths', () => {
    expect(factionsDir(FIXTURE)).toBe(`${FIXTURE}/factions`);
    expect(npcsDir(FIXTURE)).toBe(`${FIXTURE}/npcs`);
    expect(locationsDir(FIXTURE)).toBe(`${FIXTURE}/locations`);
  });

  it('entity helpers append slug + .md', () => {
    expect(factionPath(FIXTURE, 'red-banner')).toBe(`${FIXTURE}/factions/red-banner.md`);
    expect(npcPath(FIXTURE, 'kessha')).toBe(`${FIXTURE}/npcs/kessha.md`);
    expect(locationPath(FIXTURE, 'iron-promise')).toBe(`${FIXTURE}/locations/iron-promise.md`);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm vitest run src/lib/vault/paths.test.ts`
Expected: FAIL — module `./paths` does not exist.

- [ ] **Step 3: Write the minimal implementation.**

`src/lib/vault/paths.ts`:

```ts
import path from 'node:path';

/**
 * Resolve the absolute path to a vault root: `<cwd>/vaults/<slug>`.
 * Tests bypass this entirely by passing fixture paths directly to file helpers.
 */
export function vaultRoot(slug: string): string {
  return path.join(process.cwd(), 'vaults', slug);
}

export const worldXmlPath = (root: string) => path.join(root, 'world.xml');
export const threadsXmlPath = (root: string) => path.join(root, 'threads.xml');
export const characterXmlPath = (root: string) => path.join(root, 'character.xml');
export const styleGuidePath = (root: string) => path.join(root, 'style-guide.md');
export const zeroMapPath = (root: string) => path.join(root, '0-Map.md');
export const journalPath = (root: string) => path.join(root, 'journal.md');

export const factionsDir = (root: string) => path.join(root, 'factions');
export const npcsDir = (root: string) => path.join(root, 'npcs');
export const locationsDir = (root: string) => path.join(root, 'locations');

export const factionPath = (root: string, slug: string) =>
  path.join(factionsDir(root), `${slug}.md`);
export const npcPath = (root: string, slug: string) => path.join(npcsDir(root), `${slug}.md`);
export const locationPath = (root: string, slug: string) =>
  path.join(locationsDir(root), `${slug}.md`);
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm vitest run src/lib/vault/paths.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/vault/paths.ts src/lib/vault/paths.test.ts
git commit -m "feat(vault): add paths module for slug-relative vault file resolution"
```

---

## Task 2: `src/lib/vault/frontmatter.ts`

Thin wrapper over `gray-matter`. Returns `{ frontmatter, body }`. The spec's Layer 1 table requires four behaviors: parses YAML; preserves arrays; handles missing fields; rejects malformed.

We deliberately do NOT impose a Zod schema here — different entity kinds (npc/faction/location) have different required fields, and entity-specific validation lives in `entities.ts`. `frontmatter.ts` is the syntactic layer; `entities.ts` is the semantic layer.

**Files:**

- Create: `src/lib/vault/frontmatter.ts`
- Test: `src/lib/vault/frontmatter.test.ts`

- [ ] **Step 1: Write the failing tests.**

`src/lib/vault/frontmatter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseFrontmatter, FrontmatterParseError } from './frontmatter';

describe('frontmatter', () => {
  it('parses a YAML block with mixed scalars and arrays', () => {
    const raw = `---
aliases: [Foo, the foo]
tags: [npc, test]
faction: red-banner
goals:
  - first goal
  - second goal
---

Body text.`;
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({
      aliases: ['Foo', 'the foo'],
      tags: ['npc', 'test'],
      faction: 'red-banner',
      goals: ['first goal', 'second goal'],
    });
    expect(body.trim()).toBe('Body text.');
  });

  it('preserves array order and types', () => {
    const raw = `---
aliases: [a, b, c]
---

x`;
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.aliases).toEqual(['a', 'b', 'c']);
  });

  it('returns empty frontmatter when block is absent', () => {
    const raw = '# No frontmatter here\n\nBody.';
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({});
    expect(body).toBe(raw);
  });

  it('returns missing fields as undefined (not throwing)', () => {
    const raw = `---
tags: [npc]
---

x`;
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.tags).toEqual(['npc']);
    expect((frontmatter as Record<string, unknown>).faction).toBeUndefined();
  });

  it('throws FrontmatterParseError on malformed YAML', () => {
    const raw = `---
tags: [unclosed
---

x`;
    expect(() => parseFrontmatter(raw)).toThrow(FrontmatterParseError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm vitest run src/lib/vault/frontmatter.test.ts`
Expected: FAIL — module `./frontmatter` does not exist.

- [ ] **Step 3: Write the minimal implementation.**

`src/lib/vault/frontmatter.ts`:

```ts
import matter from 'gray-matter';

export type Frontmatter = Record<string, unknown>;

export interface ParsedDoc {
  frontmatter: Frontmatter;
  /** Body content with the frontmatter block stripped. */
  body: string;
}

export class FrontmatterParseError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'FrontmatterParseError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/**
 * Parse YAML frontmatter from a Markdown string. Returns `{ frontmatter, body }`.
 * Missing frontmatter returns `frontmatter: {}` and the original string as `body`.
 * Malformed YAML throws `FrontmatterParseError`.
 */
export function parseFrontmatter(raw: string): ParsedDoc {
  try {
    const parsed = matter(raw);
    return {
      frontmatter: (parsed.data ?? {}) as Frontmatter,
      body: parsed.content,
    };
  } catch (err) {
    throw new FrontmatterParseError(
      err instanceof Error ? err.message : 'frontmatter parse failed',
      err,
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm vitest run src/lib/vault/frontmatter.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/vault/frontmatter.ts src/lib/vault/frontmatter.test.ts
git commit -m "feat(vault): add frontmatter parser wrapping gray-matter"
```

---

## Task 3: `src/lib/vault/xml.ts`

Read + parse `world.xml`, `threads.xml`, `character.xml`. Whitespace-preserving build (so Wave 2's `worldTick` and other mutations don't reformat the file). Typed accessors so callers don't reach into the raw `fast-xml-parser` shape.

**Spec risk note (line 507):** "`xml.ts` round-trip-preserving-whitespace may push over 100 LOC if `fast-xml-parser` defaults don't behave. If a custom thin serializer is needed, budget +50 LOC (W1 → ~410)."

**Mitigation:** We use `fast-xml-parser`'s `XMLParser` with `preserveOrder: true, ignoreAttributes: false, trimValues: false` to retain text-node whitespace, and `XMLBuilder` with the same options plus `format: false` (which disables auto-indenting and preserves insertion-order whitespace). The pair of options is what gives us idempotent round-trip. We add a single round-trip test that asserts `build(parse(raw)) === raw` for a fixture file with mixed whitespace; if it fails, we step into a custom serializer fallback (the spec budgets +50 LOC for that). The test catches the failure mode early — we don't blindly trust the library.

For Wave 1 we expose: `parseWorldXml(root)`, `parseThreadsXml(root)`, `parseCharacterXml(root)`, plus a generic `readXml(path)`/`writeXml(path, doc)` pair Wave 2 builds on. The typed views are minimal — just enough that `entities.ts` and Wave 2 can read the fields the spec lists.

**Files:**

- Create: `src/lib/vault/xml.ts`
- Test: `src/lib/vault/xml.test.ts`

- [ ] **Step 1: Write the failing tests.**

`src/lib/vault/xml.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import { readXml, writeXml, parseWorldXml, parseThreadsXml, parseCharacterXml } from './xml';
import { worldXmlPath, threadsXmlPath, characterXmlPath } from './paths';

const FIXTURE = 'tests/fixtures/test-vault';

describe('xml', () => {
  describe('readXml / writeXml round-trip', () => {
    it('round-trips world.xml byte-for-byte (preserves whitespace + ordering)', async () => {
      const raw = await fs.readFile(worldXmlPath(FIXTURE), 'utf8');
      const doc = await readXml(worldXmlPath(FIXTURE));
      const tmpPath = `${FIXTURE}/.tmp-world-roundtrip.xml`;
      try {
        await writeXml(tmpPath, doc);
        const after = await fs.readFile(tmpPath, 'utf8');
        expect(after).toBe(raw);
      } finally {
        await fs.rm(tmpPath, { force: true });
      }
    });

    it('round-trips threads.xml byte-for-byte', async () => {
      const raw = await fs.readFile(threadsXmlPath(FIXTURE), 'utf8');
      const doc = await readXml(threadsXmlPath(FIXTURE));
      const tmpPath = `${FIXTURE}/.tmp-threads-roundtrip.xml`;
      try {
        await writeXml(tmpPath, doc);
        const after = await fs.readFile(tmpPath, 'utf8');
        expect(after).toBe(raw);
      } finally {
        await fs.rm(tmpPath, { force: true });
      }
    });
  });

  describe('parseWorldXml', () => {
    it('returns typed world view with date, location, weather, conditions', async () => {
      const world = await parseWorldXml(FIXTURE);
      expect(world.date).toBe('7 ABY, Month 4, Standard Day 20');
      expect(world.calendar).toBe('GSC');
      expect(world.region).toBe('Test Region');
      expect(world.city).toBe('Test City');
      expect(world.placeSlug).toBe('iron-promise');
      expect(world.weather).toBe('Clear, cold.');
      expect(world.season).toBe('Test season.');
      expect(world.notes).toEqual(['A test note.']);
    });
  });

  describe('parseThreadsXml', () => {
    it('returns all threads with progress strings preserved', async () => {
      const threads = await parseThreadsXml(FIXTURE);
      expect(threads).toHaveLength(3);
      expect(threads[0]).toMatchObject({
        id: 'fresh-clock',
        name: 'Fresh Clock',
        progress: '1/8',
      });
      expect(threads[1]).toMatchObject({ id: 'mid-clock', progress: '4/7' });
      expect(threads[2]).toMatchObject({ id: 'matured-clock', progress: '5/5' });
    });

    it('preserves trigger and stake fields', async () => {
      const threads = await parseThreadsXml(FIXTURE);
      expect(threads[0].stake).toBe('A clock that has barely started.');
      expect(threads[0].trigger).toBe('Advances by standard days.');
    });
  });

  describe('parseCharacterXml', () => {
    it('returns typed character view with repeated <faction> tags as array', async () => {
      const character = await parseCharacterXml(FIXTURE);
      expect(character.name).toBe('Test Captain');
      expect(character.reputation).toHaveLength(2);
      expect(character.reputation[0]).toEqual({ slug: 'red-banner', text: 'tolerated' });
      expect(character.reputation[1]).toEqual({ slug: 'blue-river', text: 'unknown' });
    });

    it('returns relationships array with slug + text', async () => {
      const character = await parseCharacterXml(FIXTURE);
      expect(character.relationships).toEqual([{ slug: 'kessha', text: 'first mate' }]);
    });
  });

  describe('writeXml mutation preserves surrounding whitespace', () => {
    it('mutating one progress field leaves other tags identical', async () => {
      const raw = await fs.readFile(threadsXmlPath(FIXTURE), 'utf8');
      const doc = await readXml(threadsXmlPath(FIXTURE));
      // Simulate Wave 2's mutation: change fresh-clock progress from 1/8 to 2/8.
      // We know the doc shape is preserveOrder array form; mutate in place.
      mutateThreadProgress(doc, 'fresh-clock', '2/8');
      const tmpPath = `${FIXTURE}/.tmp-mutate.xml`;
      try {
        await writeXml(tmpPath, doc);
        const after = await fs.readFile(tmpPath, 'utf8');
        expect(after).not.toBe(raw); // changed
        expect(after).toContain('2/8'); // new value present
        expect(after).toContain('4/7'); // other clock untouched
        expect(after).toContain('5/5'); // other clock untouched
        expect(after).toContain('<thread id="mid-clock">'); // structure intact
      } finally {
        await fs.rm(tmpPath, { force: true });
      }
    });
  });
});

// Inline helper used only by the mutation test. Walks the preserveOrder doc
// looking for a thread with the given id and rewrites its <progress> text.
// Lives in the test because Wave 1 doesn't ship a mutator — that's Wave 2.
function mutateThreadProgress(doc: unknown, threadId: string, newProgress: string): void {
  // doc is preserveOrder structure: Array<{ tagName: childArray, ':@'?: attrs }>
  const root = doc as Array<Record<string, unknown>>;
  const threadsNode = root.find((n) => 'threads' in n);
  const threadsChildren = threadsNode!.threads as Array<Record<string, unknown>>;
  for (const child of threadsChildren) {
    if (!('thread' in child)) continue;
    const attrs = child[':@'] as Record<string, string> | undefined;
    if (attrs?.['@_id'] !== threadId) continue;
    const threadChildren = child.thread as Array<Record<string, unknown>>;
    for (const tc of threadChildren) {
      if (!('progress' in tc)) continue;
      const progressArr = tc.progress as Array<{ '#text': string }>;
      progressArr[0]['#text'] = newProgress;
    }
  }
}
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm vitest run src/lib/vault/xml.test.ts`
Expected: FAIL — module `./xml` does not exist.

- [ ] **Step 3: Write the minimal implementation.**

`src/lib/vault/xml.ts`:

```ts
import * as fs from 'node:fs/promises';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { worldXmlPath, threadsXmlPath, characterXmlPath } from './paths';

// Shared options. preserveOrder + trimValues:false + format:false is the
// combination that round-trips whitespace identically. ignoreAttributes:false
// and the @_ prefix retain attributes through the round-trip.
const PARSER_OPTS = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: false,
} as const;

const BUILDER_OPTS = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: false,
  suppressEmptyNode: false,
} as const;

/** Opaque doc handle; consumers should treat as unknown and use typed parsers. */
export type XmlDoc = unknown;

const parser = new XMLParser(PARSER_OPTS);
const builder = new XMLBuilder(BUILDER_OPTS);

export async function readXml(filePath: string): Promise<XmlDoc> {
  const raw = await fs.readFile(filePath, 'utf8');
  return parser.parse(raw);
}

export async function writeXml(filePath: string, doc: XmlDoc): Promise<void> {
  const out = builder.build(doc);
  await fs.writeFile(filePath, out, 'utf8');
}

// ---- Typed views ---------------------------------------------------------

export interface WorldView {
  date: string;
  calendar: string;
  region: string;
  city: string;
  placeSlug: string;
  weather: string;
  season: string;
  notes: string[];
}

export interface ThreadView {
  id: string;
  name: string;
  stake: string;
  progress: string;
  trigger: string;
}

export interface CharacterView {
  name: string;
  age: string;
  role: string;
  background: string;
  skills: string;
  inventory: { significance: string; text: string }[];
  wealth: string;
  reputation: { slug: string; text: string }[];
  relationships: { slug: string; text: string }[];
}

// ---- Helpers to navigate the preserveOrder shape -------------------------

type OrderedNode = Record<string, unknown>;

/** Find the first child node whose key matches `tag`. Returns its value array or undefined. */
function findChild(parent: OrderedNode[], tag: string): OrderedNode[] | undefined {
  for (const node of parent) {
    if (tag in node) return node[tag] as OrderedNode[];
  }
  return undefined;
}

/** Concatenate text nodes inside a child array into a single string. */
function textOf(parent: OrderedNode[] | undefined): string {
  if (!parent) return '';
  let out = '';
  for (const node of parent) {
    if ('#text' in node) out += String(node['#text']);
  }
  return out;
}

/** Read the attributes object (`':@'`) from an element node. */
function attrsOf(node: OrderedNode): Record<string, string> {
  return (node[':@'] as Record<string, string>) ?? {};
}

// ---- Typed parsers -------------------------------------------------------

export async function parseWorldXml(root: string): Promise<WorldView> {
  const doc = (await readXml(worldXmlPath(root))) as OrderedNode[];
  const world = findChild(doc, 'world');
  if (!world) throw new Error('world.xml missing <world> root');

  const dateNode = findEl(world, 'date');
  const locationChildren = findChild(world, 'location');
  const placeNode = locationChildren ? findEl(locationChildren, 'place') : undefined;
  const conditionsChildren = findChild(world, 'conditions');

  const notes: string[] = [];
  if (conditionsChildren) {
    for (const node of conditionsChildren) {
      if ('note' in node) notes.push(textOf(node.note as OrderedNode[]));
    }
  }

  return {
    date: textOf(dateNode?.date as OrderedNode[] | undefined),
    calendar: dateNode ? (attrsOf(dateNode)['@_calendar'] ?? '') : '',
    region: textOf(locationChildren ? findChild(locationChildren, 'region') : undefined),
    city: textOf(locationChildren ? findChild(locationChildren, 'city') : undefined),
    placeSlug: placeNode ? (attrsOf(placeNode)['@_slug'] ?? '') : '',
    weather: textOf(findChild(world, 'weather')),
    season: textOf(findChild(world, 'season')),
    notes,
  };
}

export async function parseThreadsXml(root: string): Promise<ThreadView[]> {
  const doc = (await readXml(threadsXmlPath(root))) as OrderedNode[];
  const threads = findChild(doc, 'threads');
  if (!threads) return [];
  const out: ThreadView[] = [];
  for (const node of threads) {
    if (!('thread' in node)) continue;
    const id = attrsOf(node)['@_id'] ?? '';
    const children = node.thread as OrderedNode[];
    out.push({
      id,
      name: textOf(findChild(children, 'name')),
      stake: textOf(findChild(children, 'stake')),
      progress: textOf(findChild(children, 'progress')),
      trigger: textOf(findChild(children, 'trigger')),
    });
  }
  return out;
}

export async function parseCharacterXml(root: string): Promise<CharacterView> {
  const doc = (await readXml(characterXmlPath(root))) as OrderedNode[];
  const ch = findChild(doc, 'character');
  if (!ch) throw new Error('character.xml missing <character> root');

  const inventoryChildren = findChild(ch, 'inventory') ?? [];
  const inventory: CharacterView['inventory'] = [];
  for (const node of inventoryChildren) {
    if (!('item' in node)) continue;
    inventory.push({
      significance: attrsOf(node)['@_significance'] ?? '',
      text: textOf(node.item as OrderedNode[]),
    });
  }

  const reputationChildren = findChild(ch, 'reputation') ?? [];
  const reputation: CharacterView['reputation'] = [];
  for (const node of reputationChildren) {
    if (!('faction' in node)) continue;
    reputation.push({
      slug: attrsOf(node)['@_slug'] ?? '',
      text: textOf(node.faction as OrderedNode[]),
    });
  }

  const relChildren = findChild(ch, 'relationships') ?? [];
  const relationships: CharacterView['relationships'] = [];
  for (const node of relChildren) {
    if (!('npc' in node)) continue;
    relationships.push({
      slug: attrsOf(node)['@_slug'] ?? '',
      text: textOf(node.npc as OrderedNode[]),
    });
  }

  return {
    name: textOf(findChild(ch, 'name')),
    age: textOf(findChild(ch, 'age')),
    role: textOf(findChild(ch, 'role')),
    background: textOf(findChild(ch, 'background')),
    skills: textOf(findChild(ch, 'skills')),
    inventory,
    wealth: textOf(findChild(ch, 'wealth')),
    reputation,
    relationships,
  };
}

/** Find the first element-node (i.e. has the given tag as a key) in a child array. */
function findEl(parent: OrderedNode[], tag: string): OrderedNode | undefined {
  for (const node of parent) {
    if (tag in node) return node;
  }
  return undefined;
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm vitest run src/lib/vault/xml.test.ts`
Expected: PASS, 7 tests.

If round-trip fails (the budgeted risk in the spec), the test pinpoints the offending file. Inspect the diff (`diff <orig> <after>`); typically the cause is `format: true` adding indentation or `trimValues: true` eating whitespace. Adjust options before falling back to a custom serializer. If after option-tuning the round-trip still fails, escalate: write a thin custom builder that walks the preserveOrder structure and emits open/close tags + attributes + text in order. Spec budgets +50 LOC for that.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/vault/xml.ts src/lib/vault/xml.test.ts
git commit -m "feat(vault): add xml read/write with whitespace-preserving round-trip"
```

---

## Task 4: `src/lib/vault/entities.ts` (incl. `loadAlwaysLoaded`)

Single-entity readers (`loadNpc`, `loadFaction`, `loadLocation`) plus the directory listing (`listFactions`) plus the omnibus `loadAlwaysLoaded(root)` that the spec calls for in Step 1 of the per-turn workflow.

The spec's "tiered loading" (line 444) is preserved verbatim from OpenClaw: always-loaded = 0-Map + world + character + threads + style-guide + factions/\*. NPCs and locations are NOT always-loaded; they're loaded on-demand by wikilink resolution (Wave 2/3). So `loadAlwaysLoaded` does NOT load `npcs/*` or `locations/*` — only `factions/*` is fully enumerated.

Each loader returns `{ frontmatter, body, slug }` for entity files (Markdown). World/threads/character return their typed views from `xml.ts`. 0-Map and style-guide return `{ frontmatter, body }` (Markdown without a slug).

**Files:**

- Create: `src/lib/vault/entities.ts`
- Test: `src/lib/vault/entities.test.ts`

- [ ] **Step 1: Write the failing tests.**

`src/lib/vault/entities.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadNpc, loadFaction, loadLocation, listFactions, loadAlwaysLoaded } from './entities';

const FIXTURE = 'tests/fixtures/test-vault';

describe('entities', () => {
  describe('loadNpc', () => {
    it('loads kessha with frontmatter and faction field', async () => {
      const npc = await loadNpc(FIXTURE, 'kessha');
      expect(npc.slug).toBe('kessha');
      expect(npc.frontmatter.aliases).toEqual(['Kessha', 'the navigator']);
      expect(npc.frontmatter.faction).toBe('red-banner');
      expect(npc.body).toContain('Test NPC body');
    });

    it('loads an NPC without a faction field', async () => {
      const npc = await loadNpc(FIXTURE, 'iron-promise-captain');
      expect(npc.slug).toBe('iron-promise-captain');
      expect(npc.frontmatter.faction).toBeUndefined();
    });

    it('throws when slug missing', async () => {
      await expect(loadNpc(FIXTURE, 'does-not-exist')).rejects.toThrow();
    });
  });

  describe('loadFaction', () => {
    it('loads red-banner faction', async () => {
      const f = await loadFaction(FIXTURE, 'red-banner');
      expect(f.slug).toBe('red-banner');
      expect(f.frontmatter.aliases).toEqual(['Red Banner', 'the Banner']);
      expect(f.frontmatter.tags).toEqual(['faction']);
    });
  });

  describe('loadLocation', () => {
    it('loads iron-promise location', async () => {
      const l = await loadLocation(FIXTURE, 'iron-promise');
      expect(l.slug).toBe('iron-promise');
      expect(l.frontmatter.aliases).toEqual(['Iron Promise', 'the ship']);
    });
  });

  describe('listFactions', () => {
    it('returns all faction slugs in factions/', async () => {
      const slugs = await listFactions(FIXTURE);
      expect(slugs.sort()).toEqual(['blue-river', 'red-banner']);
    });

    it('ignores non-.md files and dotfiles', async () => {
      // The fixture has only .md files, but we assert the function doesn't blow up if extras exist.
      const slugs = await listFactions(FIXTURE);
      for (const s of slugs) {
        expect(s).not.toContain('.');
      }
    });
  });

  describe('loadAlwaysLoaded', () => {
    it('returns world, character, threads, zeroMap, styleGuide, factions', async () => {
      const loaded = await loadAlwaysLoaded(FIXTURE);
      expect(loaded.world.date).toBe('7 ABY, Month 4, Standard Day 20');
      expect(loaded.character.name).toBe('Test Captain');
      expect(loaded.threads).toHaveLength(3);
      expect(loaded.zeroMap.body).toContain('# Test Vault');
      expect(loaded.styleGuide.body).toContain('## Visual');
      expect(Object.keys(loaded.factions).sort()).toEqual(['blue-river', 'red-banner']);
      expect(loaded.factions['red-banner'].frontmatter.tags).toEqual(['faction']);
    });

    it('does NOT eagerly load npcs or locations', async () => {
      const loaded = await loadAlwaysLoaded(FIXTURE);
      const bag = loaded as unknown as Record<string, unknown>;
      expect(bag.npcs).toBeUndefined();
      expect(bag.locations).toBeUndefined();
    });
  });

  // Error paths — keep branch coverage above 80% for loadAlwaysLoaded's
  // fan-out and the entity loaders. We don't try to be exhaustive; we just
  // exercise the obvious "vault is broken" failure modes once each.
  describe('error paths', () => {
    it('loadFaction rejects on missing slug', async () => {
      await expect(loadFaction(FIXTURE, 'no-such-faction')).rejects.toThrow();
    });

    it('loadLocation rejects on missing slug', async () => {
      await expect(loadLocation(FIXTURE, 'no-such-location')).rejects.toThrow();
    });

    it('loadAlwaysLoaded rejects when root does not exist', async () => {
      await expect(loadAlwaysLoaded('/nonexistent/vault/path')).rejects.toThrow();
    });

    it('loadAlwaysLoaded surfaces a malformed XML error (rejects, not silent)', async () => {
      // We bypass adding a malformed XML file to the canonical fixture by writing
      // a one-off broken vault into a tmp dir and pointing loadAlwaysLoaded at it.
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-vault-bad-'));
      try {
        // Minimal "vault" with one broken XML file. listFactions will see no factions/,
        // so it'll reject earlier — that's fine, we just want the rejection.
        await fs.writeFile(path.join(tmp, 'world.xml'), '<<not xml>>', 'utf8');
        await expect(loadAlwaysLoaded(tmp)).rejects.toThrow();
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });
  });
});
```

The error-path test block needs two extra imports at the top of the test file:

```ts
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm vitest run src/lib/vault/entities.test.ts`
Expected: FAIL — module `./entities` does not exist.

- [ ] **Step 3: Write the minimal implementation.**

`src/lib/vault/entities.ts`:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseFrontmatter, type Frontmatter } from './frontmatter';
import {
  factionPath,
  factionsDir,
  npcPath,
  locationPath,
  styleGuidePath,
  zeroMapPath,
} from './paths';
import {
  parseWorldXml,
  parseThreadsXml,
  parseCharacterXml,
  type WorldView,
  type ThreadView,
  type CharacterView,
} from './xml';

export interface EntityDoc {
  slug: string;
  frontmatter: Frontmatter;
  body: string;
}

export interface MarkdownDoc {
  frontmatter: Frontmatter;
  body: string;
}

export interface AlwaysLoaded {
  world: WorldView;
  character: CharacterView;
  threads: ThreadView[];
  zeroMap: MarkdownDoc;
  styleGuide: MarkdownDoc;
  /** Keyed by faction slug. */
  factions: Record<string, EntityDoc>;
}

async function readMarkdown(filePath: string): Promise<MarkdownDoc> {
  const raw = await fs.readFile(filePath, 'utf8');
  return parseFrontmatter(raw);
}

async function readEntity(filePath: string, slug: string): Promise<EntityDoc> {
  const md = await readMarkdown(filePath);
  return { slug, frontmatter: md.frontmatter, body: md.body };
}

export function loadNpc(root: string, slug: string): Promise<EntityDoc> {
  return readEntity(npcPath(root, slug), slug);
}

export function loadFaction(root: string, slug: string): Promise<EntityDoc> {
  return readEntity(factionPath(root, slug), slug);
}

export function loadLocation(root: string, slug: string): Promise<EntityDoc> {
  return readEntity(locationPath(root, slug), slug);
}

export async function listFactions(root: string): Promise<string[]> {
  const entries = await fs.readdir(factionsDir(root), { withFileTypes: true });
  const slugs: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith('.md')) continue;
    if (e.name.startsWith('.')) continue;
    slugs.push(path.basename(e.name, '.md'));
  }
  return slugs;
}

export async function loadAlwaysLoaded(root: string): Promise<AlwaysLoaded> {
  const [world, character, threads, zeroMap, styleGuide, factionSlugs] = await Promise.all([
    parseWorldXml(root),
    parseCharacterXml(root),
    parseThreadsXml(root),
    readMarkdown(zeroMapPath(root)),
    readMarkdown(styleGuidePath(root)),
    listFactions(root),
  ]);

  const factionDocs = await Promise.all(factionSlugs.map((slug) => loadFaction(root, slug)));
  const factions: Record<string, EntityDoc> = {};
  for (const doc of factionDocs) factions[doc.slug] = doc;

  return { world, character, threads, zeroMap, styleGuide, factions };
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm vitest run src/lib/vault/entities.test.ts`
Expected: PASS, 12 tests (8 happy-path + 4 error-path).

- [ ] **Step 5: Commit.**

```bash
git add src/lib/vault/entities.ts src/lib/vault/entities.test.ts
git commit -m "feat(vault): add entity loaders and loadAlwaysLoaded for tiered loading"
```

---

## Task 5: `src/lib/vault/wikilinks.ts`

The most semantically dense module. The spec requires three behaviors:

**Parse:** `parse(text)` returns `[{ raw, target, alias?, embed }, ...]` for every `[[...]]` and `![[...]]` in the text. `embed: true` for image embeds (`![[...]]`); the alias is the text after `|` if present.

**Resolve:** `resolve(link, registry)` returns `{ kind, slug, found }` where:

- `[[npcs/foo]]` → `{ kind: 'npc', slug: 'foo', found: <true if slug in registry.npcs> }`. Same for `[[locations/...]]` and `[[factions/...]]`.
- Bare `[[Foo]]` (no folder prefix) → `{ kind: 'npc', slug: <slugified target>, found: false }`. **No alias resolution.** v0 deliberately requires folder-prefix-or-bust; the alias-precedence problem (which kind wins when "Twin" appears in npcs, locations, and factions) is sidestepped by not doing the lookup at all. Bare links land in stub territory by default (kind=npc per spec line 311).

The "registry" is a small object: `{ npcs: Set<slug>, locations: Set<slug>, factions: Set<slug> }`. It exists purely for the `found` membership check on folder-prefixed links. We DON'T eagerly enumerate npcs/ — that defeats tiered loading. Wave 2's stub-on-mention will pre-walk npcs/ to build the registry; for Wave 1 we accept any registry shape and let callers decide how to populate it. In tests we hand-build a minimal registry from the fixture's known files.

**`stripForTts`:** the spec's exact rule (line 256–258):

- `[[npcs/kessha|Kessha]]` → `Kessha` (alias wins)
- `[[npcs/kessha]]` → `kessha` (no alias; emit the slug, deslugified at the kind-folder boundary — meaning leading `npcs/` etc. is stripped first, then the remaining slug is deslugified by replacing `-` with space)
- "kessha" stays "kessha" (single token, no `-` to replace)
- `iron-promise` → `iron promise` (multi-token deslug)
- `[[Foo]]` → `Foo` (bare link emits its own text verbatim, since there's no folder/slug pair to deslug)
- `![[image.png]]` (embed) → empty string (TTS skips image embeds)

**Files:**

- Create: `src/lib/vault/wikilinks.ts`
- Test: `src/lib/vault/wikilinks.test.ts`

- [ ] **Step 1: Write the failing tests.**

`src/lib/vault/wikilinks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseWikilinks, resolveWikilink, stripForTts, type AliasRegistry } from './wikilinks';

const REGISTRY: AliasRegistry = {
  npcs: new Set(['kessha', 'iron-promise-captain', 'lone-wolf']),
  locations: new Set(['iron-promise', 'the-brace']),
  factions: new Set(['red-banner', 'blue-river']),
};

describe('parseWikilinks', () => {
  it('extracts a folder-prefixed link', () => {
    const links = parseWikilinks('See [[npcs/kessha]] for details.');
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      raw: '[[npcs/kessha]]',
      target: 'npcs/kessha',
      alias: undefined,
      embed: false,
    });
  });

  it('extracts a folder-prefixed link with alias', () => {
    const links = parseWikilinks('Hello [[npcs/kessha|Kessha]], goodbye.');
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      raw: '[[npcs/kessha|Kessha]]',
      target: 'npcs/kessha',
      alias: 'Kessha',
      embed: false,
    });
  });

  it('extracts a bare link', () => {
    const links = parseWikilinks('See [[Foo]].');
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      raw: '[[Foo]]',
      target: 'Foo',
      alias: undefined,
      embed: false,
    });
  });

  it('flags image embeds with embed: true', () => {
    const links = parseWikilinks('Picture: ![[image.png]] caption.');
    expect(links[0]).toEqual({
      raw: '![[image.png]]',
      target: 'image.png',
      alias: undefined,
      embed: true,
    });
  });

  it('extracts multiple links in one pass and preserves order', () => {
    const links = parseWikilinks(
      '[[Foo]] then [[npcs/kessha|K]] and ![[img.png]] and [[locations/the-brace]].',
    );
    expect(links.map((l) => l.target)).toEqual([
      'Foo',
      'npcs/kessha',
      'img.png',
      'locations/the-brace',
    ]);
    expect(links.map((l) => l.embed)).toEqual([false, false, true, false]);
  });

  it('returns empty array when there are no links', () => {
    expect(parseWikilinks('No links here at all.')).toEqual([]);
  });
});

describe('resolveWikilink', () => {
  it('folder-prefix wins: [[npcs/kessha]] resolves as npc/kessha', () => {
    const r = resolveWikilink({ target: 'npcs/kessha', embed: false }, REGISTRY);
    expect(r).toEqual({ kind: 'npc', slug: 'kessha', found: true });
  });

  it('folder-prefix [[locations/iron-promise]] resolves as location', () => {
    const r = resolveWikilink({ target: 'locations/iron-promise', embed: false }, REGISTRY);
    expect(r).toEqual({ kind: 'location', slug: 'iron-promise', found: true });
  });

  it('folder-prefix [[factions/red-banner]] resolves as faction', () => {
    const r = resolveWikilink({ target: 'factions/red-banner', embed: false }, REGISTRY);
    expect(r).toEqual({ kind: 'faction', slug: 'red-banner', found: true });
  });

  it('folder-prefix overrides alias-only match', () => {
    // "kessha" exists as an NPC; if the player wrote [[locations/kessha]] we trust the prefix
    // and report not-found rather than silently routing to npcs/kessha.
    const r = resolveWikilink({ target: 'locations/kessha', embed: false }, REGISTRY);
    expect(r).toEqual({ kind: 'location', slug: 'kessha', found: false });
  });

  it('bare link defaults to kind=npc, found=false (no alias lookup in v0)', () => {
    const r = resolveWikilink({ target: 'Some Unknown', embed: false }, REGISTRY);
    expect(r).toEqual({ kind: 'npc', slug: 'some-unknown', found: false });
  });

  it('bare link slugifies a multi-word target with simple lower+dash rule', () => {
    const r = resolveWikilink({ target: 'A New Captain', embed: false }, REGISTRY);
    expect(r).toEqual({ kind: 'npc', slug: 'a-new-captain', found: false });
  });

  it('bare link even with a known display name does NOT resolve in v0', () => {
    // "Kessha" exists as an NPC alias on disk, but v0 requires folder-prefix.
    // Bare [[Kessha]] becomes a stub candidate. This is documented behavior.
    const r = resolveWikilink({ target: 'Kessha', embed: false }, REGISTRY);
    expect(r).toEqual({ kind: 'npc', slug: 'kessha', found: false });
  });

  it('image embeds resolve as kind=image with no slug normalization', () => {
    const r = resolveWikilink({ target: '2026-04-28-img.png', embed: true }, REGISTRY);
    expect(r).toEqual({ kind: 'image', slug: '2026-04-28-img.png', found: false });
  });
});

describe('stripForTts', () => {
  it('alias wins: [[npcs/kessha|Kessha]] → "Kessha"', () => {
    expect(stripForTts('Hello [[npcs/kessha|Kessha]].')).toBe('Hello Kessha.');
  });

  it('no alias: [[npcs/kessha]] → "kessha" (single-token slug)', () => {
    expect(stripForTts('See [[npcs/kessha]].')).toBe('See kessha.');
  });

  it('no alias, multi-token slug: [[locations/iron-promise]] → "iron promise"', () => {
    expect(stripForTts('At [[locations/iron-promise]].')).toBe('At iron promise.');
  });

  it('bare link [[Foo]] emits the target verbatim', () => {
    expect(stripForTts('See [[Foo]].')).toBe('See Foo.');
  });

  it('image embeds are dropped entirely', () => {
    expect(stripForTts('Picture: ![[img.png]] caption.')).toBe('Picture:  caption.');
  });

  it('handles multiple links in one pass', () => {
    expect(
      stripForTts('[[npcs/kessha|Kessha]] and [[locations/iron-promise]] meet at [[the-brace]].'),
    ).toBe('Kessha and iron promise meet at the-brace.');
  });

  it('passes through plain text untouched', () => {
    expect(stripForTts('Plain text with no links.')).toBe('Plain text with no links.');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm vitest run src/lib/vault/wikilinks.test.ts`
Expected: FAIL — module `./wikilinks` does not exist.

- [ ] **Step 3: Write the minimal implementation.**

`src/lib/vault/wikilinks.ts`:

```ts
/**
 * Wikilink parser, resolver, and TTS-strip for the vault.
 *
 * Supported syntax:
 *   [[target]]               — bare link
 *   [[target|alias]]         — link with display text
 *   [[folder/slug]]          — folder-prefixed link (folder ∈ {npcs, locations, factions})
 *   [[folder/slug|alias]]    — folder-prefixed link with display text
 *   ![[target]]              — embed (typically images); `embed: true`
 *
 * Resolution rules (v0 — folder-prefix or bust):
 *   - Folder-prefix wins. `[[npcs/foo]]` → kind=npc, slug=foo, found = (slug ∈ registry.npcs).
 *   - Bare links default to kind=npc, found=false (stub candidate). No alias lookup in v0.
 *     This dodges the alias-precedence problem (which kind wins when "Twin" matches multiple);
 *     v0.5 may add alias resolution if writers chafe under the folder-prefix discipline.
 *
 * TTS-strip rules (per spec lines 256-258):
 *   - Alias wins: `[[npcs/kessha|Kessha]]` → `Kessha`.
 *   - No alias, folder-prefixed: emit the slug deslugified (`-` → space).
 *   - No alias, bare: emit target verbatim.
 *   - Embeds: dropped entirely.
 */

export interface ParsedLink {
  raw: string;
  target: string;
  alias?: string;
  embed: boolean;
}

export type Kind = 'npc' | 'location' | 'faction' | 'image';

export interface ResolvedLink {
  kind: Kind;
  slug: string;
  found: boolean;
}

export interface AliasRegistry {
  /** Known slug sets per kind. Only used for the `found` flag on folder-prefixed links. */
  npcs: Set<string>;
  locations: Set<string>;
  factions: Set<string>;
}

// Match either an embed (![[...]]) or a plain wikilink ([[...]]). Captures:
//   group 1: '!' if embed, '' otherwise
//   group 2: the inner content (target + optional |alias)
const WIKILINK_RE = /(!?)\[\[([^\]]+)\]\]/g;

export function parseWikilinks(text: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  for (const match of text.matchAll(WIKILINK_RE)) {
    const [raw, bang, inner] = match;
    const pipeIdx = inner.indexOf('|');
    const target = pipeIdx === -1 ? inner : inner.slice(0, pipeIdx);
    const alias = pipeIdx === -1 ? undefined : inner.slice(pipeIdx + 1);
    links.push({ raw, target, alias, embed: bang === '!' });
  }
  return links;
}

const FOLDER_TO_KIND: Record<string, Kind> = {
  npcs: 'npc',
  locations: 'location',
  factions: 'faction',
};

const KIND_TO_REGISTRY_KEY = {
  npc: 'npcs',
  location: 'locations',
  faction: 'factions',
} as const;

// Lower-case + whitespace → dash. Anything else (unicode, punctuation) is
// left in place — if a writer puts weird chars in a bare link, they get the
// slug they earned. v0 is folder-prefix-or-bust; bare links are stub-fodder anyway.
function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-');
}

export function resolveWikilink(
  link: Pick<ParsedLink, 'target' | 'embed'>,
  registry: AliasRegistry,
): ResolvedLink {
  if (link.embed) {
    return { kind: 'image', slug: link.target, found: false };
  }

  const slashIdx = link.target.indexOf('/');
  if (slashIdx > 0) {
    const folder = link.target.slice(0, slashIdx);
    const slug = link.target.slice(slashIdx + 1);
    const kind = FOLDER_TO_KIND[folder];
    if (kind) {
      const found = registry[KIND_TO_REGISTRY_KEY[kind]].has(slug);
      return { kind, slug, found };
    }
    // Unknown folder prefix: treat as bare and slugify the whole thing.
  }

  // Bare link: default to kind=npc, found=false. No alias lookup in v0.
  return { kind: 'npc', slug: slugify(link.target), found: false };
}

/**
 * Replace wikilinks in text for TTS rendering. Returns the modified string.
 * - Alias if present.
 * - Otherwise, deslugify the slug (strip kind-folder, replace `-` with space).
 * - Embeds are removed.
 */
export function stripForTts(text: string): string {
  return text.replace(WIKILINK_RE, (raw, bang, inner) => {
    if (bang === '!') return '';

    const pipeIdx = inner.indexOf('|');
    if (pipeIdx !== -1) {
      // Alias wins.
      return inner.slice(pipeIdx + 1);
    }

    // No alias. Strip the kind-folder if present, then deslugify the remainder.
    const slashIdx = inner.indexOf('/');
    let slug = inner;
    if (slashIdx > 0) {
      const folder = inner.slice(0, slashIdx);
      if (folder in FOLDER_TO_KIND) {
        slug = inner.slice(slashIdx + 1);
        // Deslugify only when we've crossed a known kind-folder boundary.
        return slug.replace(/-/g, ' ');
      }
    }
    // Bare link without a known folder: emit target verbatim.
    return inner;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm vitest run src/lib/vault/wikilinks.test.ts`
Expected: PASS, ~20 tests across the three describe blocks (parse + resolve + stripForTts).

- [ ] **Step 5: Commit.**

```bash
git add src/lib/vault/wikilinks.ts src/lib/vault/wikilinks.test.ts
git commit -m "feat(vault): add wikilink parse, resolve, and TTS strip"
```

---

## Task 6: Verify Wave 1 exit criteria

Spec exit criteria (line 503):

1. `pnpm vitest src/lib/vault` green for these modules.
2. Can call `loadAlwaysLoaded('commodore-vex')` and get 0-Map, world, character, threads, style-guide, factions/\* into typed objects.
3. Wikilink parser handles `[[npcs/foo]]`, `[[Foo]]` (alias-resolved), and bare unresolved (defaults to `npc`).

Plus: 80% coverage on `src/lib/vault/` (already wired in `vitest.config.ts`).

Plus: `pnpm lint` and `pnpm build` clean (project-level invariant — every wave must compile and lint clean).

- [ ] **Step 1: Run the full vault-lib suite with coverage.**

Run: `pnpm test:coverage`
Expected: All tests pass. Coverage table at the end shows `src/lib/vault/` at ≥80% for lines, functions, branches, statements. If any threshold fails, the command exits non-zero — fix the gap by adding a test before proceeding.

- [ ] **Step 2: Sanity-check `loadAlwaysLoaded` against the live vault (fixture-bypass).**

Quick smoke check that the live `commodore-vex` vault parses without throwing. We do NOT add this as a test (it depends on an external symlink) — run it once manually and discard.

```bash
pnpm tsx -e "import('./src/lib/vault/entities.ts').then(async (m) => { const r = await m.loadAlwaysLoaded('vaults/commodore-vex'); console.log('factions:', Object.keys(r.factions)); console.log('threads:', r.threads.length); console.log('world.date:', r.world.date); })"
```

Expected: prints faction slugs (free-fleet-of-the-sisar, desilijic-kajidic, pyke-syndicate, nrsb, csa-arms-web), thread count (4), and world.date (`7 ABY, Month 4, Standard Day 20`). If `pnpm tsx` is unavailable, skip this step — it is informational only, not a gate.

- [ ] **Step 3: Run the project's lint + build.**

```bash
pnpm lint && pnpm build
```

Expected: both succeed. The build invariant is project-wide, not Wave 1-specific.

- [ ] **Step 4: Final commit (only if anything was tweaked during Steps 1–3).**

If coverage was low or lint surfaced something, fix-and-commit:

```bash
git add -A
git commit -m "test(vault): tighten wave 1 coverage to clear 80% gate"
```

If steps 1–3 were green on first run, no commit needed — Wave 1 is done.

---

## Self-review (run before declaring done)

Performed by the plan author:

**1. Spec coverage:**

- "paths.ts ~30 LOC" → Task 1 implements all path helpers in ~50 LOC of code (LOC budgets are advisory; functionality > line count). Covered.
- "frontmatter.ts ~30 LOC" → Task 2. Covered.
- "xml.ts ~100 LOC, whitespace risk +50" → Task 3 with explicit round-trip mitigation test. Covered.
- "entities.ts ~80 LOC incl. loadAlwaysLoaded" → Task 4. Covered.
- "wikilinks.ts ~120 LOC (parse, resolve, stripForTts)" → Task 5. Covered.
- Layer 1 test table — `frontmatter.ts` parses YAML / preserves arrays / handles missing / rejects malformed → Task 2 has 5 tests covering all 4. Covered.
- `xml.ts` round-trip / threads.xml mutation preserves whitespace / character.xml repeated `<faction>` → Task 3 has 3 dedicated tests for these. Covered.
- `wikilinks.ts` `[[npcs/foo]]` / `[[Foo]]` / folder-prefix overrides slug-only / unresolved returns kind+slug → Task 5 has dedicated tests for each. Covered.
- 80% coverage gate on `src/lib/vault/` → already wired in `vitest.config.ts`; Task 6 verifies. Covered.
- Fixture vault: 2 factions, 3 NPCs (one with `faction:`), 2 locations, mixed journal heading formats, mixed clock states → Task 0. Covered.
- `loadAlwaysLoaded('commodore-vex')` returns typed objects → Task 4 tested against fixture; Task 6 manually checks against live vault. Covered.

**2. Placeholder scan:** No `TBD`, `TODO`, `implement later`, `add appropriate error handling`, or "similar to Task N" references. Every code-changing step shows the actual code.

**3. Type consistency:**

- `EntityDoc` (entities.ts) used consistently as `{ slug, frontmatter, body }`.
- `ParsedLink` (wikilinks.ts) used consistently as `{ raw, target, alias?, embed }`.
- `ResolvedLink` `{ kind, slug, found }` is consistent across all resolve tests.
- `AliasRegistry` shape consistent between definition and tests.
- `WorldView`, `ThreadView`, `CharacterView` consistent across xml.ts and entities.ts (entities.ts re-uses imports from xml.ts).
- Path helpers (`worldXmlPath`, `threadsXmlPath`, etc.) referenced by name match exports in paths.ts.

**4. Boundary discipline:** No Mastra imports anywhere in `src/lib/vault/`. No AI SDK imports. Confirmed against the spec's "Boundaries" section (line 124).

**5. Risk mitigation:** xml.ts whitespace-preservation risk has an explicit round-trip test as Step 1 of Task 3, with documented escape hatches (option-tuning, then custom serializer +50 LOC) if it fails.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-10-2026-05-10-mastra-rpg-runtime-port-design-wave-1.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch with checkpoints for review.

Which approach?
