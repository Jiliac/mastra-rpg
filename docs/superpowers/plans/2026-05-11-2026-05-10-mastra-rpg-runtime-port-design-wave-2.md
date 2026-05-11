# Wave 2 — Vault Write-Side + State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure-TypeScript vault write-side at `src/lib/vault/` (turnId, lock, journal, stubs, threads, playtests) so the workflow can mint per-turn IDs, hold a per-slug mutex across hot reloads, append journal entries with `world.xml`-derived headings, tick story clocks, harvest mature threads, drop wikilink-stubs with sentence-window excerpts, and log per-day playtest entries — without any Mastra, AI SDK, or provider dependency.

**Architecture:** Six new focused modules in `src/lib/vault/`, each with one clear responsibility and a tight LOC budget (`turnId.ts` ~40, `lock.ts` ~50, `journal.ts` ~100, `stubs.ts` ~80, `threads.ts` ~100, `playtests.ts` ~60). All build on Wave-1 helpers (`paths.ts`, `xml.ts` raw-text round-trips, `wikilinks.ts`, `frontmatter.ts`, `entities.ts`). Tests run against a hand-built fixture vault at `tests/fixtures/test-vault/` (already created in Wave 1) plus tmp-vault scratch dirs for any test that mutates state. The coverage gate at 80% on `src/lib/vault/**/*.ts` is already wired in `vitest.config.ts`.

**Tech Stack:** TypeScript (ES2022, strict), Node 22.13+ `node:fs/promises`, vitest + @vitest/coverage-v8 (no new runtime deps). Re-uses `fast-xml-parser` indirectly only where Wave-1 typed parsers already do — `threads.ts` and `journal.ts` operate on raw file text via regex for surgical edits (mirroring OpenClaw's `state.py` semantics — see Reference §). No `gray-matter` needed in Wave 2 production code (`stubs.ts` emits frontmatter as a fixed string literal).

**Source spec:** `docs/superpowers/specs/2026-05-10-mastra-rpg-runtime-port-design.md` — Wave 2 section (lines 509–528), Concurrency invariants (lines 346–367), Stub-on-mention (lines 307–313), Testing → Layer 1 (lines 379–396), Identifier formats / "What carries over" (lines 438–447). The OpenClaw reference implementation at `/Users/valentin/Development/ai/maz_rpg/openclaw/skills/rpg-state/scripts/state.py` is the ground truth for journal format, world-tick semantics, stub frontmatter, and playtest layout — verbatim where the spec calls them "preserved."

**Wave-1 outputs you depend on (already merged in PR #1, do NOT modify):**

- `src/lib/vault/paths.ts`: `vaultRoot`, `worldXmlPath`, `threadsXmlPath`, `characterXmlPath`, `journalPath`, `zeroMapPath`, `factionPath`, `npcPath`, `locationPath`, `factionsDir`, `npcsDir`, `locationsDir`.
- `src/lib/vault/frontmatter.ts`: `parseFrontmatter(raw) → { frontmatter, body }`, `FrontmatterParseError`.
- `src/lib/vault/xml.ts`: typed `parseWorldXml`, `parseThreadsXml`, `parseCharacterXml`, generic `readXml`/`writeXml`. Wave 2 does NOT use `writeXml` for `threads.xml`: round-tripping pretty-printed XML through `fast-xml-parser`'s builder reshuffles whitespace and re-collapses empty nodes. We mutate `threads.xml` with a `<progress>` regex sub on raw text, matching OpenClaw's `cmd_world_tick`. `journal.md`'s heading needs only `world.xml`'s `<date>` text; we use Wave-1's `parseWorldXml` for that.
- `src/lib/vault/entities.ts`: `loadAlwaysLoaded`, `listFactions`, `loadNpc/Faction/Location`. Wave 2 does NOT call these — but `lock.ts` and `turnId.ts` accept `root: string` (absolute path) parameters, same convention.
- `src/lib/vault/wikilinks.ts`: `parseWikilinks`, `resolveWikilink`, `Kind`, `AliasRegistry`. Wave 2's `stubs.ts` consumes a pre-resolved `{ kind, slug }` produced by the caller — it does not parse wikilinks itself.

**Tests fixture you depend on (already created in Wave 1):** `tests/fixtures/test-vault/` — 2 factions, 3 NPCs (kessha has `faction: red-banner`), 2 locations, `journal.md` with 3 mixed-format headings, `threads.xml` with `1/8`, `4/7`, `5/5` clock states, `world.xml` with date `7 ABY, Month 4, Standard Day 20`.

---

## Pre-flight check (informational — do NOT re-run if green)

Before starting, verify that Wave 1 is in fact in place. If anything below is missing or has drifted, **stop and report** rather than fix inline — Wave 1 is a separate ticket.

- [ ] **Verify Wave-1 source files exist.**

```bash
ls src/lib/vault/{paths,frontmatter,xml,entities,wikilinks}.ts
```

Expected: all five paths listed without error. If any are missing, abort and report — Wave 1 incomplete.

- [ ] **Verify Wave-1 tests pass and coverage gate is in place.**

```bash
pnpm test --run
```

Expected: all existing tests green. If anything fails, abort and report — Wave 2 must build on a green baseline.

- [ ] **Verify the fixture vault is present.**

```bash
ls tests/fixtures/test-vault/world.xml tests/fixtures/test-vault/threads.xml tests/fixtures/test-vault/journal.md
```

Expected: all three files listed. If missing, abort — Wave 1 fixture is missing.

- [ ] **Verify `vitest.config.ts` still has the 80% gate on `src/lib/vault/`.**

```bash
grep -F "'src/lib/vault/**/*.ts'" vitest.config.ts && grep -E "lines: 80" vitest.config.ts
```

Expected: both `grep`s print a matching line. If not, abort.

- [ ] **Verify the working tree is clean on the wave-2 branch.**

```bash
git status -uno && git rev-parse --abbrev-ref HEAD
```

Expected: clean tree, branch `auto/2026-05-10-mastra-rpg-runtime-port-design-wave-2`.

---

## File structure

Production files (all new, all under `src/lib/vault/`):

| File           | Responsibility                                                                                                                                                                                                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `turnId.ts`    | `mintTurnId(root) → "turn-NNN"`. Reads `<root>/.turn-counter`, increments, writes atomically (tmp + rename), zero-pads to 3 digits. Tolerates a missing or malformed file (starts at 1). Mirrors OpenClaw `cmd_mint_turn_id`.                                                                                                       |
| `lock.ts`      | Synchronous in-memory mutex per vault slug, with a `globalThis` HMR-safe registry. `acquireMutex(root) → boolean` (true if newly held; false on contention). `releaseMutex(root) → void` (idempotent). `isLocked(root) → boolean`. No I/O, no `.lock` file (spec deliberately drops OpenClaw's `flock` for v0).                     |
| `journal.ts`   | `parseRecentEntries(root, n) → Promise<JournalEntry[]>` (split on `^## `, return last `n`). `appendJournal(root, turnId, prose) → Promise<void>` — heading is derived from `world.xml`'s `<date>`. Heading format: `## <date> — <turnId>`. Adds `# Journal` if file is missing. Mirrors OpenClaw `cmd_append_journal`.              |
| `stubs.ts`     | `extractExcerpt(prose, target) → string \| null` (sentence containing the link + one sentence on each side). `createStub(root, link, prose) → Promise<{ path, created }>` — writes a stub markdown file with frontmatter `{ aliases: [], tags: [<kind>, stub], faction: (for npcs) }`. Idempotent (skips if file exists).           |
| `threads.ts`   | `worldTick(root, { days?, hours? }) → Promise<MaturedThread[]>`. Reads raw `threads.xml`, advances every `<progress>cur/total</progress>` by `delta = days ?? Math.floor(hours/24)`, clamping at `total`; collects threads that crossed into `cur === total` as matured; writes back atomically. Mirrors OpenClaw `cmd_world_tick`. |
| `playtests.ts` | `appendPlaytest(root, turnId, body) → Promise<string>` (returns absolute path written). Creates `<root>/playtests/<YYYY-MM-DD>.md` if missing; appends a `\n## <turnId>\n<body>\n` block. Mirrors OpenClaw `cmd_playtests_append`.                                                                                                  |

Test files (co-located + a couple of tmp-vault helpers):

| File                              | Responsibility                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/vault/turnId.test.ts`    | Mint from no file (creates with `1`); monotonic; tolerates gaps; pads to 3 digits; malformed counter starts at 1; atomic on tmp dir.        |
| `src/lib/vault/lock.test.ts`      | First acquire returns true; second returns false; release allows next; `finally`-release pattern; survives a simulated module-cache wipe.   |
| `src/lib/vault/journal.test.ts`   | `parseRecentEntries(5)` over fixture journal (3 sections, three heading formats); append derives `## <date> — turn-NNN`; missing file.      |
| `src/lib/vault/stubs.test.ts`     | Excerpt: sentence + neighbors; multiple matches → first match; missing target → null; create-stub idempotent; NPC stub includes `faction:`. |
| `src/lib/vault/threads.test.ts`   | `worldTick({days:1})` ticks every clock; matured returned (the `5/5` thread does NOT re-mature — only fresh-matures); hours fallback.       |
| `src/lib/vault/playtests.test.ts` | Creates file if missing; appends `## turn-NNN` block; appends a second turn block without trampling first; `playtests/` parent created.     |

No new fixtures. Test helpers (e.g., `mkTmpVault`) live inline in each test file to avoid premature DRY — the duplication is 4 lines per spec.

---

## Implementation order (TDD discipline)

The spec mandates 80% coverage on `src/lib/vault/` and tests-first per Layer 1. Each task follows red-green-refactor explicitly: Step "Write the failing test" → Step "Run to verify it fails" → Step "Write minimal implementation" → Step "Run to verify it passes" → Step "Commit". Do not batch implementation ahead of tests.

Order (leaf-most first; mirrors the spec's listed order in Wave 2 table):

1. **Task 1: `turnId.ts`** — leaf-most (no deps beyond `paths.ts`); flush out the atomic-write pattern we'll reuse in `threads.ts`.
2. **Task 2: `lock.ts`** — pure in-memory with a `globalThis` quirk; no I/O; small surface.
3. **Task 3: `journal.ts`** — depends on `parseWorldXml` (Wave 1) for heading date.
4. **Task 4: `stubs.ts`** — depends on `paths.ts` only; consumes a pre-resolved wikilink from caller.
5. **Task 5: `threads.ts`** — biggest of the bunch; surgical regex edit on raw `threads.xml`.
6. **Task 6: `playtests.ts`** — file append + per-day filename; simplest.
7. **Task 7: Coverage gate verification + commit.**

Why this order: `lock.ts` is dropped between `turnId` and `journal` so it gets immediate review attention (it's the most subtle module). `threads.ts` is placed second-to-last because its regex behavior is easiest to verify after `journal.ts`'s simpler heading-derivation has shaken out the "raw-text-mutation" pattern.

---

## Task 1: `turnId.ts` — mint per-turn IDs against `.turn-counter`

The spec requires monotonic, gap-tolerant, 3-digit-zero-padded turn IDs (lines 442–443: "Identifier formats (`turn-NNN`, ...) — verbatim"). OpenClaw's `cmd_mint_turn_id` is the verbatim reference: read `<root>/.turn-counter`, parse as int, increment, atomic-write with trailing newline, return `f"turn-{n:03d}"`. Missing file → starts at 1. Malformed content → starts at 1 (per spec's "tolerates gaps").

**Files:**

- Create: `src/lib/vault/turnId.ts`
- Test: `src/lib/vault/turnId.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// src/lib/vault/turnId.test.ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { mintTurnId } from './turnId';

async function tmpRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'rpg-vault-turnid-'));
}

describe('mintTurnId', () => {
  it('creates .turn-counter with 1 when no file exists, returns turn-001', async () => {
    const root = await tmpRoot();
    try {
      const id = await mintTurnId(root);
      expect(id).toBe('turn-001');
      const raw = await fs.readFile(path.join(root, '.turn-counter'), 'utf8');
      expect(raw.trim()).toBe('1');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('increments monotonically across calls', async () => {
    const root = await tmpRoot();
    try {
      expect(await mintTurnId(root)).toBe('turn-001');
      expect(await mintTurnId(root)).toBe('turn-002');
      expect(await mintTurnId(root)).toBe('turn-003');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('pads to 3 digits at small numbers and keeps growing past 999', async () => {
    const root = await tmpRoot();
    try {
      await fs.writeFile(path.join(root, '.turn-counter'), '9\n');
      expect(await mintTurnId(root)).toBe('turn-010');
      await fs.writeFile(path.join(root, '.turn-counter'), '999\n');
      expect(await mintTurnId(root)).toBe('turn-1000');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('tolerates a gap (counter advanced externally)', async () => {
    const root = await tmpRoot();
    try {
      await fs.writeFile(path.join(root, '.turn-counter'), '42\n');
      expect(await mintTurnId(root)).toBe('turn-043');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('treats malformed counter content as 0 (next call returns turn-001)', async () => {
    const root = await tmpRoot();
    try {
      await fs.writeFile(path.join(root, '.turn-counter'), 'not a number\n');
      expect(await mintTurnId(root)).toBe('turn-001');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('writes atomically (no leftover .tmp on success)', async () => {
    const root = await tmpRoot();
    try {
      await mintTurnId(root);
      const entries = await fs.readdir(root);
      expect(entries.filter((e) => e.endsWith('.tmp'))).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm test --run src/lib/vault/turnId.test.ts
```

Expected: FAIL with `Cannot find module './turnId'`.

- [ ] **Step 3: Write the minimal implementation.**

```ts
// src/lib/vault/turnId.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Mint the next turn id for the given vault root. Reads `<root>/.turn-counter`,
 * increments, writes back atomically, and returns `turn-NNN` (zero-padded to
 * 3 digits; grows beyond that as needed for n > 999). Missing or malformed
 * counter contents reset to 0 → returned id is `turn-001`.
 *
 * Atomic-write pattern: write to `<path>.tmp`, then `rename` over `<path>`.
 * `fs.rename` is atomic on POSIX, which is the only platform v0 targets.
 */
export async function mintTurnId(root: string): Promise<string> {
  const counterPath = path.join(root, '.turn-counter');
  let n = 0;
  try {
    const raw = await fs.readFile(counterPath, 'utf8');
    const parsed = Number.parseInt(raw.trim() || '0', 10);
    if (Number.isFinite(parsed) && parsed >= 0) n = parsed;
  } catch (err) {
    // ENOENT is fine — first turn for this vault. Anything else, also fine —
    // we treat a malformed/unreadable counter as 0 per spec "tolerates gaps".
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Swallow; the OpenClaw reference does the same (ValueError → 0).
    }
  }
  n += 1;
  await atomicWriteText(counterPath, `${n}\n`);
  return `turn-${String(n).padStart(3, '0')}`;
}

async function atomicWriteText(filePath: string, data: string): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, data, 'utf8');
  await fs.rename(tmp, filePath);
}
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
pnpm test --run src/lib/vault/turnId.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/vault/turnId.ts src/lib/vault/turnId.test.ts
git commit -m "$(cat <<'EOF'
feat(vault): mint turn ids against .turn-counter with atomic write

Adds src/lib/vault/turnId.ts mirroring OpenClaw's cmd_mint_turn_id:
read counter → increment → atomic-write → return turn-NNN zero-padded.
Tolerates missing/malformed counter (resets to 0). Tests cover gap
tolerance, monotonic increment, padding through 1000, and atomic-no-leftover.
EOF
)"
```

---

## Task 2: `lock.ts` — in-memory per-slug mutex with `globalThis` HMR guard

The spec's Concurrency invariants §2 is exact about the implementation pattern (lines 357–362):

```ts
const g = globalThis as { __rpg_locks?: Map<string, Promise<void>> };
g.__rpg_locks ??= new Map();
```

But the spec also says (line 351, §1): release MUST live in `finally`, and (table line 330) contention "returns false synchronously." We therefore choose `Map<string, true>` over `Map<string, Promise<void>>` — `Promise<void>` only buys us awaiting another holder's release, which we never want in v0 (contention is rejected, not queued). The simpler `Set<string>` shape captures both invariants and lines up with the test for contention rejection. We name the global key the same (`__rpg_locks`) so a future v0.5 promise-queued implementation can swap the inner type without renaming. (Spec §3 lines 363–365: workflow does NOT propagate AbortSignal — that's a workflow concern, not the lock's. The lock's only job is acquire/release/isHeld.)

**Files:**

- Create: `src/lib/vault/lock.ts`
- Test: `src/lib/vault/lock.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// src/lib/vault/lock.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { acquireMutex, releaseMutex, isLocked } from './lock';

// Each test runs against a fresh slug to avoid cross-test contamination of
// the process-global Map. We don't expose a "clear-all" helper because no
// production caller should ever need one.
const slug = (suffix: string) =>
  `test-vault-lock-${suffix}-${Math.random().toString(36).slice(2, 8)}`;

describe('lock', () => {
  it('first acquire returns true; lock is held', () => {
    const s = slug('a');
    expect(isLocked(s)).toBe(false);
    expect(acquireMutex(s)).toBe(true);
    expect(isLocked(s)).toBe(true);
    releaseMutex(s);
  });

  it('second acquire while held returns false synchronously', () => {
    const s = slug('b');
    expect(acquireMutex(s)).toBe(true);
    // Synchronous, no await. If this returned a promise we'd be in trouble.
    expect(acquireMutex(s)).toBe(false);
    releaseMutex(s);
  });

  it('release allows next acquire', () => {
    const s = slug('c');
    acquireMutex(s);
    releaseMutex(s);
    expect(isLocked(s)).toBe(false);
    expect(acquireMutex(s)).toBe(true);
    releaseMutex(s);
  });

  it('release is idempotent: calling twice does not throw', () => {
    const s = slug('d');
    acquireMutex(s);
    releaseMutex(s);
    expect(() => releaseMutex(s)).not.toThrow();
  });

  it('different slugs do not contend', () => {
    const s1 = slug('e1');
    const s2 = slug('e2');
    expect(acquireMutex(s1)).toBe(true);
    expect(acquireMutex(s2)).toBe(true);
    releaseMutex(s1);
    releaseMutex(s2);
  });

  it('try/finally semantics release even when work throws', () => {
    const s = slug('f');
    expect(acquireMutex(s)).toBe(true);
    expect(() => {
      try {
        throw new Error('boom');
      } finally {
        releaseMutex(s);
      }
    }).toThrow('boom');
    expect(isLocked(s)).toBe(false);
  });

  it('uses globalThis to survive a simulated module-cache wipe (HMR-safe)', async () => {
    const s = slug('hmr');
    expect(acquireMutex(s)).toBe(true);
    // Reach into globalThis the same way lock.ts does and assert the set
    // shape — this is the contract Next.js dev-mode HMR relies on. We can't
    // truly evict the module from vitest's cache mid-test, but we can verify
    // the global registry exists and contains the slug, which is the
    // necessary-and-sufficient HMR property.
    const g = globalThis as unknown as { __rpg_locks?: Set<string> };
    expect(g.__rpg_locks).toBeInstanceOf(Set);
    expect(g.__rpg_locks!.has(s)).toBe(true);
    releaseMutex(s);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm test --run src/lib/vault/lock.test.ts
```

Expected: FAIL with `Cannot find module './lock'`.

- [ ] **Step 3: Write the minimal implementation.**

```ts
// src/lib/vault/lock.ts
/**
 * Per-vault-slug in-memory mutex. Synchronous acquire/release. Contention
 * returns false (rejected, not queued).
 *
 * The lock state lives on `globalThis` so Next.js dev-mode HMR — which
 * recreates module scopes — does NOT lose held state. Spec invariant §2.
 *
 * Implementation note: a `Set<string>` (rather than `Map<string, Promise>`)
 * suffices because v0 rejects contention rather than awaiting it. A future
 * v0.5 queueing implementation can swap the inner type behind the same
 * globalThis key.
 *
 * The lock is NOT durable across process restarts; the spec's failure-matrix
 * row "workflow process crash mid-turn" accepts that the in-memory lock
 * dies with the process and the turn-counter may waste an ID.
 */

const GLOBAL_KEY = '__rpg_locks' as const;

type LockBag = { [GLOBAL_KEY]?: Set<string> };

function locks(): Set<string> {
  const g = globalThis as LockBag;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Set<string>();
  return g[GLOBAL_KEY]!;
}

/** Try to acquire the mutex for `key` (typically a vault slug or absolute root path). */
export function acquireMutex(key: string): boolean {
  const set = locks();
  if (set.has(key)) return false;
  set.add(key);
  return true;
}

/** Release the mutex for `key`. Idempotent. */
export function releaseMutex(key: string): void {
  locks().delete(key);
}

/** Inspect whether the mutex is held. Useful for tests; production code should not branch on this. */
export function isLocked(key: string): boolean {
  return locks().has(key);
}
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
pnpm test --run src/lib/vault/lock.test.ts
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/vault/lock.ts src/lib/vault/lock.test.ts
git commit -m "$(cat <<'EOF'
feat(vault): in-memory mutex with globalThis HMR guard

Adds src/lib/vault/lock.ts. acquireMutex returns true on first hold,
false synchronously on contention. releaseMutex is idempotent. State
lives on globalThis.__rpg_locks (Set<string>) so Next.js dev-mode HMR
doesn't lose held state across module recompiles (spec invariant §2).

Different slugs don't contend; try/finally releases on throw.
EOF
)"
```

---

## Task 3: `journal.ts` — parse recent entries + append heading derived from `world.xml`

The spec is precise (line 528): "appendJournal writes a heading whose date matches world.xml". OpenClaw's `cmd_append_journal` is the verbatim reference (lines 323–334 of `state.py`): `## <world_date> — <turnId>\n\n<prose>\n`, with `# Journal\n` prepended if the file is missing, and the existing file's trailing whitespace stripped before appending. `parseRecentEntries` mirrors `_journal_sections` (lines 268–282): split on `^## ` lines, return the last `n` as `[{ heading, body }]`.

The fixture journal (`tests/fixtures/test-vault/journal.md`) deliberately includes three different heading formats — `## 7 ABY, Month 4, Day 18 — Prologue`, `## 7 ABY, Month 4, Standard Day 18 — turn-001`, `## Turn 002 - 7 ABY, Month 4, Day 19` — so `parseRecentEntries` is forced to treat the heading as opaque text, not parse it.

**Files:**

- Create: `src/lib/vault/journal.ts`
- Test: `src/lib/vault/journal.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// src/lib/vault/journal.test.ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseRecentEntries, appendJournal } from './journal';

const FIXTURE = 'tests/fixtures/test-vault';

async function tmpVault(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'rpg-vault-journal-'));
}

describe('parseRecentEntries', () => {
  it('returns the last n entries with heading + body preserved verbatim', async () => {
    const entries = await parseRecentEntries(FIXTURE, 2);
    expect(entries).toHaveLength(2);
    expect(entries[0].heading).toBe('7 ABY, Month 4, Standard Day 18 — turn-001');
    expect(entries[0].body).toContain('Turn-001 prose mentions');
    expect(entries[1].heading).toBe('Turn 002 - 7 ABY, Month 4, Day 19');
    expect(entries[1].body).toContain('Turn-002 prose mentions');
  });

  it('returns all entries when n exceeds total', async () => {
    const entries = await parseRecentEntries(FIXTURE, 99);
    expect(entries).toHaveLength(3);
  });

  it('treats the heading line as opaque text (handles format drift)', async () => {
    const entries = await parseRecentEntries(FIXTURE, 3);
    // Three different heading formats in the fixture; none should crash.
    expect(entries.map((e) => e.heading)).toEqual([
      '7 ABY, Month 4, Day 18 — Prologue',
      '7 ABY, Month 4, Standard Day 18 — turn-001',
      'Turn 002 - 7 ABY, Month 4, Day 19',
    ]);
  });

  it('returns [] when journal.md is missing', async () => {
    const root = await tmpVault();
    try {
      const entries = await parseRecentEntries(root, 5);
      expect(entries).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('clamps n to >= 1', async () => {
    const entries = await parseRecentEntries(FIXTURE, 0);
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });
});

describe('appendJournal', () => {
  // Each append test runs against a copy of the fixture so we don't trample
  // the original. We copy world.xml + journal.md only.
  async function freshVault(withJournal: boolean): Promise<string> {
    const root = await tmpVault();
    await fs.copyFile(path.join(FIXTURE, 'world.xml'), path.join(root, 'world.xml'));
    if (withJournal) {
      await fs.copyFile(path.join(FIXTURE, 'journal.md'), path.join(root, 'journal.md'));
    }
    return root;
  }

  it('appends a heading derived from world.xml date', async () => {
    const root = await freshVault(true);
    try {
      await appendJournal(root, 'turn-099', 'New prose body.');
      const journal = await fs.readFile(path.join(root, 'journal.md'), 'utf8');
      expect(journal).toContain('## 7 ABY, Month 4, Standard Day 20 — turn-099\n\nNew prose body.');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('creates journal.md with a # Journal header if missing', async () => {
    const root = await freshVault(false);
    try {
      await appendJournal(root, 'turn-001', 'First entry.');
      const journal = await fs.readFile(path.join(root, 'journal.md'), 'utf8');
      expect(journal.startsWith('# Journal\n')).toBe(true);
      expect(journal).toContain('## 7 ABY, Month 4, Standard Day 20 — turn-001\n\nFirst entry.');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('preserves existing entries (does not truncate)', async () => {
    const root = await freshVault(true);
    try {
      await appendJournal(root, 'turn-099', 'New prose body.');
      const journal = await fs.readFile(path.join(root, 'journal.md'), 'utf8');
      expect(journal).toContain('Prologue prose.');
      expect(journal).toContain('Turn-001 prose mentions');
      expect(journal).toContain('New prose body.');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('strips trailing whitespace from existing file before appending', async () => {
    const root = await freshVault(false);
    try {
      // Pre-seed journal with extra trailing whitespace.
      await fs.writeFile(path.join(root, 'journal.md'), '# Journal\n\n## Old\n\nOld body.\n\n\n\n');
      await appendJournal(root, 'turn-002', 'New body.');
      const journal = await fs.readFile(path.join(root, 'journal.md'), 'utf8');
      // Exactly one blank line between previous body and new heading.
      expect(journal).toMatch(/Old body\.\n\n## 7 ABY[^\n]+— turn-002\n\nNew body\.\n$/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('falls back to "## <turnId>" if world.xml lacks a date', async () => {
    const root = await tmpVault();
    try {
      // Minimal world.xml without a <date> element.
      await fs.writeFile(
        path.join(root, 'world.xml'),
        '<world><location><region>x</region></location></world>\n',
      );
      await appendJournal(root, 'turn-001', 'Body.');
      const journal = await fs.readFile(path.join(root, 'journal.md'), 'utf8');
      expect(journal).toContain('## turn-001\n\nBody.');
      expect(journal).not.toContain('— turn-001');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm test --run src/lib/vault/journal.test.ts
```

Expected: FAIL with `Cannot find module './journal'`.

- [ ] **Step 3: Write the minimal implementation.**

```ts
// src/lib/vault/journal.ts
import * as fs from 'node:fs/promises';
import { journalPath, worldXmlPath } from './paths';
import { parseWorldXml } from './xml';

export interface JournalEntry {
  /** The full heading line, with `## ` prefix stripped. Treated as opaque text. */
  heading: string;
  /** Body content under this heading, up to the next `## ` or EOF. */
  body: string;
}

/**
 * Split `<root>/journal.md` on `^## ` headings and return the last `n`
 * entries (oldest-to-newest). Missing file returns `[]`. The heading is
 * treated as opaque text — callers must not parse it. Three heading
 * formats exist in real vaults; we cope by not caring.
 */
export async function parseRecentEntries(root: string, n: number): Promise<JournalEntry[]> {
  const count = Math.max(1, n);
  let raw: string;
  try {
    raw = await fs.readFile(journalPath(root), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const entries: JournalEntry[] = [];
  let heading: string | null = null;
  let body: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('## ')) {
      if (heading !== null) entries.push({ heading, body: body.join('\n') });
      heading = line.slice(3).trim();
      body = [];
    } else if (heading !== null) {
      body.push(line);
    }
  }
  if (heading !== null) entries.push({ heading, body: body.join('\n') });

  return entries.slice(-count);
}

/**
 * Append a turn entry to `<root>/journal.md`. The heading is
 *   `## <world.xml date> — <turnId>`
 * or `## <turnId>` if `world.xml` lacks a `<date>`. Creates the file with a
 * `# Journal` header if missing. Strips trailing whitespace from the existing
 * file before appending, so there's exactly one blank line between entries.
 *
 * Mirrors OpenClaw `cmd_append_journal`. The world date is read fresh on
 * each call — `worldTick` may have updated it earlier in the same workflow.
 */
export async function appendJournal(root: string, turnId: string, prose: string): Promise<void> {
  const date = await readWorldDate(root);
  const heading = date ? `## ${date} — ${turnId}` : `## ${turnId}`;
  const trimmed = prose.trim();
  const block = `\n\n${heading}\n\n${trimmed}\n`;

  const filePath = journalPath(root);
  let existing: string | null = null;
  try {
    existing = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const next = existing === null ? `# Journal${block}` : `${existing.replace(/\s+$/, '')}${block}`;
  await fs.writeFile(filePath, next, 'utf8');
}

async function readWorldDate(root: string): Promise<string> {
  try {
    const world = await parseWorldXml(root);
    return world.date.trim();
  } catch {
    // world.xml missing, malformed, or no <date>: fall back to date-less heading.
    return '';
  }
}

// Re-export the path helper to keep this module's surface obvious to callers
// who want to check the file location without importing paths.ts.
export { worldXmlPath };
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
pnpm test --run src/lib/vault/journal.test.ts
```

Expected: all 9 tests PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/vault/journal.ts src/lib/vault/journal.test.ts
git commit -m "$(cat <<'EOF'
feat(vault): journal parse + append with world.xml-derived heading

Adds src/lib/vault/journal.ts. parseRecentEntries splits on ^## and
returns last n entries as {heading, body}, treating headings as opaque
to survive format drift. appendJournal derives the heading from
world.xml's <date> ("## <date> — <turnId>"), falls back to "## <turnId>"
if date missing, creates file with "# Journal" header if absent, and
strips trailing whitespace so spacing between entries stays consistent.
Mirrors OpenClaw cmd_append_journal verbatim.
EOF
)"
```

---

## Task 4: `stubs.ts` — excerpt extraction + stub file creation

Spec lines 307–313: stub frontmatter is `{ aliases: [], tags: [<kind>, stub], faction: (npc only) }` (the spec also lists `created`, `status: stub`, `first_mention: turnId`, but the OpenClaw reference at `cmd_create_stub` lines 396–399 emits only `aliases`, `tags`, `faction`, and the body excerpt — we follow the reference because the spec's "Identifier formats … — verbatim" clause means the reference behavior is the source of truth). Body excerpt is the sentence containing the link + one sentence on each side. The sentence split mirrors OpenClaw's `_SENT_SPLIT` regex: split on `.!?` followed by whitespace then a capital/quote/`[`.

This module takes a pre-resolved `{ kind, slug }` from the caller (workflow / Wave 5) rather than parsing wikilinks itself — that responsibility belongs to `wikilinks.ts` (Wave 1) and the workflow that picks the cap-of-2 set. `stubs.ts` only knows how to extract an excerpt and write a file.

**Files:**

- Create: `src/lib/vault/stubs.ts`
- Test: `src/lib/vault/stubs.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// src/lib/vault/stubs.test.ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { extractExcerpt, createStub } from './stubs';

async function tmpVault(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-vault-stubs-'));
  await fs.mkdir(path.join(root, 'npcs'), { recursive: true });
  await fs.mkdir(path.join(root, 'locations'), { recursive: true });
  await fs.mkdir(path.join(root, 'factions'), { recursive: true });
  return root;
}

describe('extractExcerpt', () => {
  it('returns the matching sentence with one neighbor on each side', () => {
    const prose =
      'First sentence. Second sentence mentions [[npcs/drovokk|Drovokk]]. Third sentence. Fourth sentence.';
    const out = extractExcerpt(prose, 'drovokk');
    expect(out).toBe(
      'First sentence. Second sentence mentions [[npcs/drovokk|Drovokk]]. Third sentence.',
    );
  });

  it('handles folder-prefixed target form ("npcs/drovokk")', () => {
    const prose = 'A. The priest [[npcs/drovokk]] is testifying. B.';
    const out = extractExcerpt(prose, 'npcs/drovokk');
    expect(out).toBe('A. The priest [[npcs/drovokk]] is testifying. B.');
  });

  it('handles bare links resolved through slugification', () => {
    const prose = 'Alpha. Bravo [[Drovokk]] arrives. Charlie.';
    // Caller passes the slug; we tolerate the original target text in the link.
    const out = extractExcerpt(prose, 'drovokk');
    expect(out).toBe('Alpha. Bravo [[Drovokk]] arrives. Charlie.');
  });

  it('clamps to start/end when the match is at the boundary', () => {
    const prose = '[[npcs/foo]] starts. Second. Third.';
    const out = extractExcerpt(prose, 'foo');
    expect(out).toBe('[[npcs/foo]] starts. Second.');
  });

  it('returns null when target is not found', () => {
    const prose = 'No links here at all.';
    expect(extractExcerpt(prose, 'foo')).toBeNull();
  });

  it('returns the first match when the target appears multiple times', () => {
    const prose = 'A. First [[npcs/foo]]. B. Second [[npcs/foo]] mention. C.';
    const out = extractExcerpt(prose, 'foo');
    expect(out).toBe('A. First [[npcs/foo]]. B.');
  });
});

describe('createStub', () => {
  it('writes an npc stub with faction: line and tags [npc, stub]', async () => {
    const root = await tmpVault();
    try {
      const res = await createStub(root, {
        kind: 'npc',
        slug: 'drovokk',
        excerptProse: 'A. Priest [[npcs/drovokk]] testifies. B.',
      });
      expect(res.created).toBe(true);
      const written = await fs.readFile(path.join(root, 'npcs', 'drovokk.md'), 'utf8');
      expect(written).toContain('---\naliases: []\ntags: [npc, stub]\nfaction:\n---\n');
      expect(written).toContain('Priest [[npcs/drovokk]] testifies.');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('writes a location stub WITHOUT faction:', async () => {
    const root = await tmpVault();
    try {
      const res = await createStub(root, {
        kind: 'location',
        slug: 'saint-of-vontor',
        excerptProse: 'A. The [[locations/saint-of-vontor]] hangs in the void. B.',
      });
      expect(res.created).toBe(true);
      const written = await fs.readFile(path.join(root, 'locations', 'saint-of-vontor.md'), 'utf8');
      expect(written).toContain('---\naliases: []\ntags: [location, stub]\n---\n');
      expect(written).not.toContain('faction:');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('writes a faction stub with tags [faction, stub] and no faction: line', async () => {
    const root = await tmpVault();
    try {
      const res = await createStub(root, {
        kind: 'faction',
        slug: 'free-fleet',
        excerptProse: 'A. The [[factions/free-fleet]] declares neutrality. B.',
      });
      expect(res.created).toBe(true);
      const written = await fs.readFile(path.join(root, 'factions', 'free-fleet.md'), 'utf8');
      expect(written).toContain('tags: [faction, stub]');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('is idempotent: existing file returns { created: false } and is not overwritten', async () => {
    const root = await tmpVault();
    try {
      await fs.writeFile(path.join(root, 'npcs', 'drovokk.md'), 'original content');
      const res = await createStub(root, {
        kind: 'npc',
        slug: 'drovokk',
        excerptProse: 'irrelevant',
      });
      expect(res.created).toBe(false);
      const written = await fs.readFile(path.join(root, 'npcs', 'drovokk.md'), 'utf8');
      expect(written).toBe('original content');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('falls back to a placeholder body when excerpt is empty', async () => {
    const root = await tmpVault();
    try {
      const res = await createStub(root, {
        kind: 'npc',
        slug: 'orphan',
        excerptProse: '', // caller passed empty prose; body should not be blank
      });
      expect(res.created).toBe(true);
      const written = await fs.readFile(path.join(root, 'npcs', 'orphan.md'), 'utf8');
      expect(written).toContain('_Stub created by GM. Body to be filled in._');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('creates the parent directory if missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-vault-stubs-nodir-'));
    try {
      // Don't pre-create npcs/
      const res = await createStub(root, {
        kind: 'npc',
        slug: 'fresh',
        excerptProse: 'a. [[npcs/fresh]] arrives. b.',
      });
      expect(res.created).toBe(true);
      const stat = await fs.stat(path.join(root, 'npcs', 'fresh.md'));
      expect(stat.isFile()).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm test --run src/lib/vault/stubs.test.ts
```

Expected: FAIL with `Cannot find module './stubs'`.

- [ ] **Step 3: Write the minimal implementation.**

```ts
// src/lib/vault/stubs.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Kind } from './wikilinks';
import { npcsDir, factionsDir, locationsDir } from './paths';

// Sentence split: end-of-sentence punctuation, then whitespace, then a
// sentence-opener (capital ASCII letter, " or [, or a Latin-1 capital).
// Mirrors OpenClaw `_SENT_SPLIT`. Imperfect — Mr. Smith and similar will
// split mid-sentence — but the spec's "best-effort but safe" applies.
const SENT_SPLIT = /(?<=[.!?])\s+(?=["[A-ZÀ-Ý])/;

/**
 * Find the sentence containing the wikilink that targets `slug` and return
 * that sentence plus one neighbor on each side, joined by a single space.
 * Returns `null` if the target is not found anywhere in `prose`.
 *
 * Matching is lenient: the link in prose may be `[[slug]]`, `[[folder/slug]]`,
 * or `[[folder/slug|Alias]]`. The caller passes the bare slug (or, optionally,
 * `folder/slug`); we strip any folder prefix and match case-insensitively.
 *
 * Mirrors OpenClaw `_extract_excerpt`.
 */
export function extractExcerpt(prose: string, target: string): string | null {
  const slugOnly = target.includes('/') ? target.slice(target.lastIndexOf('/') + 1) : target;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // First try: any wikilink whose target ends in slugOnly (optionally with folder/, optionally |alias).
  const re1 = new RegExp(`\\[\\[(?:[^\\]|]*/)?${esc(slugOnly)}(?:\\|[^\\]]*)?\\]\\]`, 'i');
  let match = prose.match(re1);
  // Fall back to literal-target match if the caller passed `folder/slug`.
  if (!match) {
    const re2 = new RegExp(`\\[\\[${esc(target)}(?:\\|[^\\]]*)?\\]\\]`, 'i');
    match = prose.match(re2);
  }
  if (!match || match.index === undefined) return null;

  const pos = match.index;
  const sentences = prose.split(SENT_SPLIT);
  let cursor = 0;
  let sentIdx = 0;
  for (let i = 0; i < sentences.length; i++) {
    const end = cursor + sentences[i].length;
    if (cursor <= pos && pos <= end) {
      sentIdx = i;
      break;
    }
    cursor = end + 1; // +1 for the separator we removed
  }
  const lo = Math.max(0, sentIdx - 1);
  const hi = Math.min(sentences.length, sentIdx + 2);
  return sentences.slice(lo, hi).join(' ').trim();
}

export interface CreateStubInput {
  kind: Kind;
  slug: string;
  /** The prose the link appeared in. Used to extract the body excerpt. */
  excerptProse: string;
}

export interface CreateStubResult {
  path: string;
  created: boolean;
}

const KIND_TO_DIR: Record<Exclude<Kind, 'image'>, (root: string) => string> = {
  npc: npcsDir,
  faction: factionsDir,
  location: locationsDir,
};

/**
 * Create a stub markdown file under the appropriate kind-folder. Idempotent:
 * if the file already exists, returns `{ created: false }` without touching
 * it. Frontmatter is fixed:
 *   aliases: []
 *   tags: [<kind>, stub]
 *   faction:               (for kind === 'npc' only)
 *
 * Body is the extracted sentence-window excerpt; if extraction yields nothing
 * (empty prose, or target not literally present), falls back to a placeholder.
 *
 * Mirrors OpenClaw `cmd_create_stub`. Images cannot be stubbed (no entity).
 */
export async function createStub(root: string, input: CreateStubInput): Promise<CreateStubResult> {
  if (input.kind === 'image') {
    throw new Error('createStub: cannot stub an image embed (no entity kind)');
  }
  const dirFn = KIND_TO_DIR[input.kind];
  const dir = dirFn(root);
  const filePath = path.join(dir, `${input.slug}.md`);

  try {
    await fs.stat(filePath);
    return { path: filePath, created: false };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const fmLines = ['---', 'aliases: []', `tags: [${input.kind}, stub]`];
  if (input.kind === 'npc') fmLines.push('faction:');
  fmLines.push('---');

  const excerpt =
    input.excerptProse.length > 0 ? (extractExcerpt(input.excerptProse, input.slug) ?? '') : '';
  const body = excerpt !== '' ? excerpt : '_Stub created by GM. Body to be filled in._';

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, `${fmLines.join('\n')}\n\n${body}\n`, 'utf8');
  return { path: filePath, created: true };
}
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
pnpm test --run src/lib/vault/stubs.test.ts
```

Expected: all 12 tests PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/vault/stubs.ts src/lib/vault/stubs.test.ts
git commit -m "$(cat <<'EOF'
feat(vault): stub creation with sentence-window excerpt

Adds src/lib/vault/stubs.ts. extractExcerpt finds the matching wikilink
(folder-prefixed or bare; alias-tolerant) and returns sentence ± one
neighbor. createStub writes the file under the kind-folder with fixed
frontmatter ({aliases:[], tags:[<kind>, stub], faction: for npcs}),
idempotent on existing files, with placeholder body if excerpt empty.

Mirrors OpenClaw _extract_excerpt and cmd_create_stub. Spec lines 307-313.
EOF
)"
```

---

## Task 5: `threads.ts` — `worldTick` advances every clock and returns matured

Spec exit criterion (line 526): "`worldTick({days: 1})` correctly advances every clock and returns the matured-thread list." OpenClaw's `cmd_world_tick` (lines 414–453 of `state.py`) is the verbatim reference: read raw `threads.xml`, regex-substitute each `<thread>...<progress>cur/total</progress>...</thread>` block by advancing `cur` by `delta` (clamped at `total`), and collect threads that **crossed into** `cur === total` during _this_ tick as matured. Pre-matured (already-at-total) threads are NOT re-reported. `delta = days ?? Math.floor(hours/24)`, minimum 0, default 1.

We deliberately re-use OpenClaw's regex-on-raw-text approach instead of round-tripping through `fast-xml-parser`'s builder: a builder round-trip on a pretty-printed `threads.xml` reorders trailing whitespace and may collapse empty elements, breaking byte-level diffs that humans rely on when reviewing vault changes in git. The regex is surgical — only the `<progress>` content changes, every other byte is preserved.

**Files:**

- Create: `src/lib/vault/threads.ts`
- Test: `src/lib/vault/threads.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// src/lib/vault/threads.test.ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { worldTick } from './threads';

const FIXTURE = 'tests/fixtures/test-vault';

async function tmpVaultWithThreads(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-vault-threads-'));
  await fs.copyFile(path.join(FIXTURE, 'threads.xml'), path.join(root, 'threads.xml'));
  return root;
}

describe('worldTick', () => {
  it('advances every non-matured clock by 1 day', async () => {
    const root = await tmpVaultWithThreads();
    try {
      const matured = await worldTick(root, { days: 1 });
      const text = await fs.readFile(path.join(root, 'threads.xml'), 'utf8');
      // fresh: 1/8 → 2/8; mid: 4/7 → 5/7; matured-clock was 5/5 → still 5/5 (clamped)
      expect(text).toContain('<progress>2/8</progress>');
      expect(text).toContain('<progress>5/7</progress>');
      expect(text).toContain('<progress>5/5</progress>');
      // The pre-matured 5/5 thread does NOT show up — it was already at total.
      expect(matured).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('returns matured threads that CROSS into cur === total during this tick', async () => {
    const root = await tmpVaultWithThreads();
    try {
      // mid-clock is at 4/7; tick by 3 days → 7/7 (newly matured).
      const matured = await worldTick(root, { days: 3 });
      expect(matured.map((t) => t.id).sort()).toEqual(['mid-clock']);
      expect(matured[0].name).toBe('Mid Clock');
      expect(matured[0].stake).toContain('midpoint');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('caps at total (does not overshoot)', async () => {
    const root = await tmpVaultWithThreads();
    try {
      // fresh-clock is 1/8; tick by 99 → 8/8 (capped, newly matured).
      const matured = await worldTick(root, { days: 99 });
      const text = await fs.readFile(path.join(root, 'threads.xml'), 'utf8');
      expect(text).toContain('<progress>8/8</progress>');
      expect(text).toContain('<progress>7/7</progress>');
      expect(matured.map((t) => t.id).sort()).toEqual(['fresh-clock', 'mid-clock']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('uses hours fallback: 48h → 2 days; 23h → 0 days (floor)', async () => {
    const root = await tmpVaultWithThreads();
    try {
      const matured = await worldTick(root, { hours: 23 });
      const text = await fs.readFile(path.join(root, 'threads.xml'), 'utf8');
      // 23h floors to 0 days; nothing advances.
      expect(text).toContain('<progress>1/8</progress>');
      expect(matured).toEqual([]);

      await worldTick(root, { hours: 48 });
      const text2 = await fs.readFile(path.join(root, 'threads.xml'), 'utf8');
      // 48h floors to 2 days; fresh 1/8 → 3/8, mid 4/7 → 6/7.
      expect(text2).toContain('<progress>3/8</progress>');
      expect(text2).toContain('<progress>6/7</progress>');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('returns [] for a zero or negative tick (no-op)', async () => {
    const root = await tmpVaultWithThreads();
    try {
      expect(await worldTick(root, { days: 0 })).toEqual([]);
      expect(await worldTick(root, { days: -3 })).toEqual([]);
      // File unchanged.
      const text = await fs.readFile(path.join(root, 'threads.xml'), 'utf8');
      expect(text).toContain('<progress>1/8</progress>');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('preserves whitespace and non-progress content byte-for-byte (except <progress>)', async () => {
    const root = await tmpVaultWithThreads();
    try {
      const before = await fs.readFile(path.join(root, 'threads.xml'), 'utf8');
      await worldTick(root, { days: 1 });
      const after = await fs.readFile(path.join(root, 'threads.xml'), 'utf8');
      // Compute the diff by removing only the <progress>...</progress> bodies.
      const stripProg = (s: string) =>
        s.replace(/<progress>[^<]*<\/progress>/g, '<progress>X</progress>');
      expect(stripProg(after)).toBe(stripProg(before));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('throws when threads.xml is missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-vault-threads-missing-'));
    try {
      await expect(worldTick(root, { days: 1 })).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('defaults to 1 day when no field is provided', async () => {
    const root = await tmpVaultWithThreads();
    try {
      await worldTick(root, {});
      const text = await fs.readFile(path.join(root, 'threads.xml'), 'utf8');
      expect(text).toContain('<progress>2/8</progress>');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm test --run src/lib/vault/threads.test.ts
```

Expected: FAIL with `Cannot find module './threads'`.

- [ ] **Step 3: Write the minimal implementation.**

```ts
// src/lib/vault/threads.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { threadsXmlPath } from './paths';

export interface MaturedThread {
  id: string;
  name: string;
  stake: string;
}

export interface TickInput {
  /** Whole days to advance. Takes precedence over hours. Default: 1. */
  days?: number;
  /** Hours; floored to whole days. Ignored if `days` is provided. */
  hours?: number;
}

// Match a <thread id="..."> ... </thread> block, with the id pulled out.
const THREAD_RE = /<thread\b([^>]*)>([\s\S]*?)<\/thread>/g;
const ID_RE = /\bid="([^"]+)"/;
const NAME_RE = /<name>([^<]*)<\/name>/;
const STAKE_RE = /<stake>([\s\S]*?)<\/stake>/;
const PROGRESS_RE = /<progress>\s*(\d+)\s*\/\s*(\d+)\s*<\/progress>/;

/**
 * Advance every clock in `<root>/threads.xml` by `delta` (days; or hours
 * floored to days), clamped at each thread's total. Returns the list of
 * threads that CROSSED INTO cur === total during this tick (pre-matured
 * threads are not re-reported).
 *
 * Writes back via atomic tmp+rename. Whitespace and non-progress content
 * preserved byte-for-byte. Mirrors OpenClaw `cmd_world_tick`.
 */
export async function worldTick(root: string, input: TickInput): Promise<MaturedThread[]> {
  const delta = computeDelta(input);
  const filePath = threadsXmlPath(root);
  if (delta <= 0) {
    // Touch the file to confirm it exists (so a missing-file test still throws
    // before returning the no-op result). Cheap stat — no read.
    await fs.stat(filePath);
    return [];
  }

  const raw = await fs.readFile(filePath, 'utf8');
  const matured: MaturedThread[] = [];

  const next = raw.replace(THREAD_RE, (whole, openAttrs: string, body: string) => {
    const idMatch = openAttrs.match(ID_RE);
    const id = idMatch ? idMatch[1] : '';
    const progMatch = body.match(PROGRESS_RE);
    if (!progMatch) return whole;
    const cur = Number.parseInt(progMatch[1], 10);
    const total = Number.parseInt(progMatch[2], 10);
    if (!Number.isFinite(cur) || !Number.isFinite(total) || cur >= total) return whole;

    const newCur = Math.min(cur + delta, total);
    const newProgress = `<progress>${newCur}/${total}</progress>`;
    const newBody =
      body.slice(0, progMatch.index!) +
      newProgress +
      body.slice(progMatch.index! + progMatch[0].length);

    if (newCur >= total) {
      const nameMatch = newBody.match(NAME_RE);
      const stakeMatch = newBody.match(STAKE_RE);
      matured.push({
        id,
        name: nameMatch ? nameMatch[1].trim() : '',
        stake: stakeMatch ? stakeMatch[1].trim().replace(/\s+/g, ' ') : '',
      });
    }

    return `<thread${openAttrs}>${newBody}</thread>`;
  });

  await atomicWriteText(filePath, next);
  return matured;
}

function computeDelta(input: TickInput): number {
  if (typeof input.days === 'number') return Math.max(0, Math.floor(input.days));
  if (typeof input.hours === 'number') return Math.max(0, Math.floor(input.hours / 24));
  return 1;
}

async function atomicWriteText(filePath: string, data: string): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, data, 'utf8');
  await fs.rename(tmp, filePath);
}

// Re-export for callers wanting the canonical file path without importing paths.
export { threadsXmlPath };
// Avoid an unused-import lint hit if path/threadsXmlPath drift later.
void path;
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
pnpm test --run src/lib/vault/threads.test.ts
```

Expected: all 8 tests PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/vault/threads.ts src/lib/vault/threads.test.ts
git commit -m "$(cat <<'EOF'
feat(vault): worldTick advances clocks and reports newly matured

Adds src/lib/vault/threads.ts. worldTick reads raw threads.xml,
advances every <progress>cur/total</progress> by delta (days, or
hours floored to days; default 1), clamps at total, and returns the
list of threads that CROSSED INTO cur === total this tick.

Surgical regex edit preserves whitespace byte-for-byte (no
fast-xml-parser builder round-trip). Atomic tmp+rename write.
Mirrors OpenClaw cmd_world_tick. Spec exit criterion line 526.
EOF
)"
```

---

## Task 6: `playtests.ts` — per-day file append

OpenClaw's `cmd_playtests_append` (lines 671–678) is verbatim: `<root>/playtests/<YYYY-MM-DD>.md`, append `\n## <turnId>\n<body>\n`. Filename is "today's ISO date" by the local system clock; that matches the reference behavior and is what the existing `commodore-vex/playtests/` files were produced by. We expose an optional `today` override for tests so we don't have to clock-mock.

**Files:**

- Create: `src/lib/vault/playtests.ts`
- Test: `src/lib/vault/playtests.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// src/lib/vault/playtests.test.ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { appendPlaytest } from './playtests';

async function tmpVault(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'rpg-vault-playtests-'));
}

describe('appendPlaytest', () => {
  it('creates playtests/<date>.md if missing and writes a turn block', async () => {
    const root = await tmpVault();
    try {
      const written = await appendPlaytest(root, 'turn-001', 'first body', { today: '2026-05-11' });
      expect(written).toBe(path.join(root, 'playtests', '2026-05-11.md'));
      const text = await fs.readFile(written, 'utf8');
      expect(text).toBe('\n## turn-001\nfirst body\n');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('appends a second turn block without disturbing the first', async () => {
    const root = await tmpVault();
    try {
      await appendPlaytest(root, 'turn-001', 'first body', { today: '2026-05-11' });
      await appendPlaytest(root, 'turn-002', 'second body', { today: '2026-05-11' });
      const text = await fs.readFile(path.join(root, 'playtests', '2026-05-11.md'), 'utf8');
      expect(text).toBe('\n## turn-001\nfirst body\n\n## turn-002\nsecond body\n');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('creates the playtests/ parent directory if missing', async () => {
    const root = await tmpVault();
    try {
      await appendPlaytest(root, 'turn-003', 'body', { today: '2026-05-12' });
      const stat = await fs.stat(path.join(root, 'playtests'));
      expect(stat.isDirectory()).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rotates filenames on a new ISO date', async () => {
    const root = await tmpVault();
    try {
      await appendPlaytest(root, 'turn-100', 'monday body', { today: '2026-05-11' });
      await appendPlaytest(root, 'turn-101', 'tuesday body', { today: '2026-05-12' });
      const mon = await fs.readFile(path.join(root, 'playtests', '2026-05-11.md'), 'utf8');
      const tue = await fs.readFile(path.join(root, 'playtests', '2026-05-12.md'), 'utf8');
      expect(mon).toContain('turn-100');
      expect(mon).not.toContain('turn-101');
      expect(tue).toContain('turn-101');
      expect(tue).not.toContain('turn-100');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('strips trailing whitespace from body before appending', async () => {
    const root = await tmpVault();
    try {
      const written = await appendPlaytest(root, 'turn-007', 'body with trailing\n\n\n', {
        today: '2026-05-11',
      });
      const text = await fs.readFile(written, 'utf8');
      expect(text).toBe('\n## turn-007\nbody with trailing\n');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('defaults to system today when `today` is not provided', async () => {
    const root = await tmpVault();
    try {
      const written = await appendPlaytest(root, 'turn-008', 'b');
      const today = new Date().toISOString().slice(0, 10);
      expect(written).toBe(path.join(root, 'playtests', `${today}.md`));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm test --run src/lib/vault/playtests.test.ts
```

Expected: FAIL with `Cannot find module './playtests'`.

- [ ] **Step 3: Write the minimal implementation.**

```ts
// src/lib/vault/playtests.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface AppendPlaytestOptions {
  /** ISO date `YYYY-MM-DD` to use for the filename. Defaults to today (system clock). */
  today?: string;
}

/**
 * Append a `## <turnId>\n<body>\n` block (prefixed with one blank line) to
 * `<root>/playtests/<today>.md`. Creates the playtests/ directory and the
 * file if missing. Returns the absolute path written.
 *
 * Mirrors OpenClaw `cmd_playtests_append`. The `today` override exists so
 * tests can pin filenames without monkey-patching Date.
 */
export async function appendPlaytest(
  root: string,
  turnId: string,
  body: string,
  options: AppendPlaytestOptions = {},
): Promise<string> {
  const today = options.today ?? isoToday();
  const dir = path.join(root, 'playtests');
  const filePath = path.join(dir, `${today}.md`);
  await fs.mkdir(dir, { recursive: true });
  const trimmed = body.replace(/\s+$/, '');
  await fs.appendFile(filePath, `\n## ${turnId}\n${trimmed}\n`, 'utf8');
  return filePath;
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
pnpm test --run src/lib/vault/playtests.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/vault/playtests.ts src/lib/vault/playtests.test.ts
git commit -m "$(cat <<'EOF'
feat(vault): playtests per-day file append

Adds src/lib/vault/playtests.ts. appendPlaytest writes
\n## <turnId>\n<body>\n to <root>/playtests/<YYYY-MM-DD>.md, creating
the directory and file on first call of the day. Optional `today`
override for deterministic tests. Mirrors OpenClaw cmd_playtests_append.
EOF
)"
```

---

## Task 7: Coverage gate verification + final compile check

The spec's exit criteria (lines 524–528) require all vault-lib unit tests green and coverage ≥80%. The gate is already wired in `vitest.config.ts` (Wave 1 set it up; we verify here that the new modules clear it).

**Files:**

- (No new files. Verification only.)

- [ ] **Step 1: Run the full vault test suite with coverage.**

```bash
pnpm test:coverage
```

Expected: All tests pass. Coverage report shows ≥80% on `src/lib/vault/**` for lines, functions, branches, statements. If any of `turnId.ts`, `lock.ts`, `journal.ts`, `stubs.ts`, `threads.ts`, or `playtests.ts` is below 80% on any metric, add a targeted test (typically a branch you haven't exercised) and re-run before moving on.

- [ ] **Step 2: Run lint to confirm no style regressions.**

```bash
pnpm lint
```

Expected: clean. If anything fires, fix in-place (we are still in TDD's "refactor" phase — fixing lint is part of green).

- [ ] **Step 3: Run a typecheck via the Next.js build.**

```bash
pnpm build
```

Expected: TypeScript compiles. The build will also run Next.js page compilation, which is unaffected by these pure-TS modules — but if any of our new files has a type error, the build catches it. If `pnpm build` is heavy in this environment, an acceptable substitute is `npx tsc --noEmit` if `tsc` is available; otherwise run `pnpm build`.

- [ ] **Step 4: Manual hot-reload smoke for `lock.ts` (per spec exit criterion line 527).**

The spec calls for "globalThis map verified by manual test." Vitest cannot simulate Next.js's actual HMR, but the contract we need is: the `globalThis.__rpg_locks` Set persists across module-cache evictions. Confirm this by inspection:

```bash
grep -n "globalThis" src/lib/vault/lock.ts
```

Expected: at least one match, on a line that reads `const g = globalThis as LockBag;` (or equivalent — we accept either `g[GLOBAL_KEY]` or `g.__rpg_locks` indirection). The unit test in Task 2 already asserts the Set is reachable through `globalThis.__rpg_locks`; together these satisfy the exit criterion.

For a true live HMR test (optional, do NOT block the wave on it): start `pnpm dev`, hit `acquireMutex('foo')` from a Next.js API route or REPL, edit the calling file to trigger HMR, and observe that the second `acquireMutex('foo')` still returns `false`. This is human-verified only; the unit test gives us the regression-safety.

- [ ] **Step 5: Final wave commit (no code; CHANGELOG-style record).**

If steps 1–4 pass with no code changes needed, no commit is necessary — Tasks 1–6 already captured all production code. If you made small targeted-coverage additions in Step 1, commit them now:

```bash
git add src/lib/vault/
git commit -m "$(cat <<'EOF'
test(vault): bump targeted branch coverage above 80% gate

Adds the remaining branch-coverage tests needed to clear the vitest
threshold on Wave 2 modules.
EOF
)"
```

(If no coverage gaps existed, skip this step. Do not create an empty commit.)

---

## Self-review checklist (run inline; fix issues as you find them)

These were applied while writing the plan; they're listed here so a reviewer (or the agent re-reading the plan) can re-run them.

1. **Spec coverage.** Every row of the Wave 2 LOC table has a corresponding task:
   - `turnId.ts` → Task 1.
   - `lock.ts` → Task 2.
   - `journal.ts` → Task 3.
   - `stubs.ts` → Task 4.
   - `threads.ts` → Task 5.
   - `playtests.ts` → Task 6.

   Every exit criterion (lines 524–528) maps to a task:
   - "All vault-lib unit tests green; coverage ≥80%" → Task 7 Step 1.
   - "worldTick({days: 1}) … returns the matured-thread list" → Task 5 Steps 1, 3 (test + impl).
   - "Mutex acquire/release is synchronous, contention returns false, and the lock survives Next.js hot-reload (globalThis map verified by manual test)" → Task 2 Steps 1, 3, and Task 7 Step 4.
   - "appendJournal writes a heading whose date matches world.xml" → Task 3 Steps 1, 3.

   Every row of the Layer-1 Testing table (lines 391–395) has tests:
   - `journal.ts` "format drift" + heading-derivation → Task 3 tests 1 & 2.
   - `stubs.ts` "excerpt extraction returns sentence + neighbors; alias extraction best-effort but safe" → Task 4 `extractExcerpt` tests.
   - `turnId.ts` "monotonic; tolerates gaps; pads to 3 digits" → Task 1 tests 2, 4, 3.
   - `lock.ts` "second acquire returns false synchronously; release allows next; finally semantics; survives hot-reload" → Task 2 tests 2, 3, 6, 7.
   - `threads.ts` "worldTick({days:1}) advances every clock; matured threads returned; on-disk state correct" → Task 5 tests 1, 2, 6.
   - `playtests.ts` "appends to per-day file; creates if missing; `## turn-NNN` heading matches OpenClaw" → Task 6 tests 1, 3, 2.

2. **Placeholder scan.** No "TBD", "TODO" (in plan text — the `_Stub created by GM. Body to be filled in._` placeholder _inside_ a stub file is intentional and is a verbatim OpenClaw string), "implement later", "add appropriate error handling", or "similar to Task N". Every code block is complete and self-contained.

3. **Type consistency.**
   - `mintTurnId(root: string) → Promise<string>` — used the same name everywhere.
   - `acquireMutex(key: string) → boolean`, `releaseMutex(key: string) → void`, `isLocked(key: string) → boolean` — consistent across Task 2's test, impl, and exit-criterion text.
   - `JournalEntry = { heading, body }` — `heading` (not `title` or `header`) used consistently.
   - `Kind` imported from `wikilinks.ts` (Wave 1) into `stubs.ts`; no shadow definition.
   - `MaturedThread = { id, name, stake }` — used in both test and impl.
   - `worldTick(root, { days?, hours? })` signature matches across all references.
   - `appendPlaytest(root, turnId, body, options?)` signature consistent.

4. **Reference verbatim.** OpenClaw `state.py` was consulted for: `cmd_mint_turn_id` (lines 252–263), `_journal_sections` + `cmd_append_journal` (lines 268–334), `_extract_excerpt` + `cmd_create_stub` (lines 358–403), `cmd_world_tick` (lines 414–453), `cmd_playtests_append` (lines 671–678). Our TypeScript ports match the documented semantics; deltas from the Python (e.g., `Set<string>` instead of a `.lock` file, atomic-write helper instead of `_atomic_write`) are explicitly chosen and justified in the relevant task's preamble.

---

## Out of scope (do NOT touch in this wave)

- Wave 3 schemas/dossiers/media — separate ticket; do not introduce `src/lib/schemas.ts`, `src/lib/dossier.ts`, or `src/lib/media/`.
- Mastra agents, tools, workflow — separate ticket (W4/W5).
- API route, UI — separate ticket (W6).
- Cleanup of `weather-agent` / `weather-workflow` — out-of-band cleanup per spec line 602.
- Touching the live `vaults/commodore-vex/` symlink target — all tests use either the read-only fixture at `tests/fixtures/test-vault/` or a tmp-vault.
- v0.5 features: `flock`-based external lock, alias resolution in `wikilinks.ts`, discretionary off-stage faction spawns, prep skill.
