# Wave 3 — Schemas, Dossiers, Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure-TypeScript contracts and external-service wrappers at `src/lib/schemas.ts`, `src/lib/dossier.ts`, `src/lib/media/tts.ts`, and `src/lib/media/image.ts` so Wave 4's tools/agents and Wave 5's workflow can: validate agent I/O via Zod (`FactionOutput`, `NarratorOutput`, `IllustratorOutput`, `ImageMeta`); assemble per-agent dossiers (faction / narrator / illustrator) from already-loaded vault state plus a pure `identifyOnStage` deterministic on-stage detector and an `extractVisualBlock` style-guide reader; render Inworld TTS 2 → mp3 → ffmpeg → ogg audio; and write `gpt-image-2` PNGs with a collision-proof `YYYYMMDD-HHMMSS-<slug>-<6char-rand>.png` filename pattern.

**Architecture:** Four new focused files. `schemas.ts` (~50 LOC) is pure Zod with no I/O. `dossier.ts` (~200 LOC) is pure: three string builders, one deterministic detector, one regex extractor — all take pre-loaded objects (no `fs` reads). `media/tts.ts` (~80 LOC) does HTTPS POST to Inworld TTS v2 (`api.inworld.ai/tts/v1/voice` per OpenClaw reference) → base64 decode → MP3 buffer → `ffmpeg` child process pipe → OGG Opus file. `media/image.ts` (~80 LOC) does HTTPS POST to OpenAI `/v1/images/generations` with `model: gpt-image-2`, `response_format: b64_json`, decodes the b64 image, and writes a PNG with a timestamp + slug + 6-char random suffix filename under `<vaultRoot>/images/`. No new runtime deps: `fetch` is global in Node 22; `ffmpeg` is shelled via `node:child_process` (already required to be on PATH per spec Error-matrix line 339).

**Tech Stack:** TypeScript (ES2022, strict), Zod 4 (already present), Node 22.13+ `node:fs/promises`, `node:crypto.randomBytes` for the 6-char filename suffix, `node:child_process.spawn` for `ffmpeg`, global `fetch`. Tests use vitest + `vi.fn()` to stub `fetch` and child-process for unit-level coverage of `tts.ts` / `image.ts` (the spec calls them "live tests, stubbable" — we structure the modules so the network/process boundaries are injectable). No new package.json dependencies are introduced in this wave.

**Source spec:** `docs/superpowers/specs/2026-05-10-mastra-rpg-runtime-port-design.md` — Wave 3 section (lines 529–545), Output schemas Zod block (lines 143–172), Per-turn workflow Step 1/3/4 dossier construction (lines 177–262), `stripForTts` semantics (lines 256–258 — already implemented in Wave-1 `wikilinks.ts`, consumed by `tts.ts`), Error-matrix rows for "Image generation 5xx", "TTS API failure", "ffmpeg not on PATH" (lines 336–339), and Concurrency invariant §4 "Image filename includes random suffix" (lines 366–367). The OpenClaw reference scripts at `/Users/valentin/Development/ai/maz_rpg/openclaw/skills/inworld-tts/scripts/tts.sh` and `/Users/valentin/Development/ai/maz_rpg/openclaw/skills/rpg-image/scripts/image.py` are ground truth for the API endpoints, voice id (`Hank`), model id (`inworld-tts-1.5-max` — per spec line 323 may be re-verified at impl time but we ship with that), and the `## Visual` regex (`_VISUAL_RE`).

**Wave-1 outputs you depend on (already merged, do NOT modify):**

- `src/lib/vault/paths.ts`: `vaultRoot`, `factionsDir`, `npcsDir`, `locationsDir`, `npcPath`, `factionPath`, `locationPath`. `dossier.ts` and `media/image.ts` use `vaultRoot(slug)` and a derived `imagesDir` helper.
- `src/lib/vault/entities.ts`: `AlwaysLoaded`, `EntityDoc`, `MarkdownDoc`, `loadNpc`, `loadFaction`, `loadLocation`, `loadAlwaysLoaded`, `listFactions`. Dossier builders accept pre-loaded `AlwaysLoaded` plus per-entity `EntityDoc[]` from the caller — no reads inside `dossier.ts`.
- `src/lib/vault/xml.ts`: `WorldView`, `CharacterView`, `ThreadView`. Faction + narrator dossiers embed these as text blocks.
- `src/lib/vault/wikilinks.ts`: `parseWikilinks`, `resolveWikilink`, `Kind`, `AliasRegistry`, `stripForTts`. `identifyOnStage` re-uses `parseWikilinks` to scan recent journal + player input for `[[npcs/foo]]` mentions; `media/tts.ts` calls `stripForTts` on the input prose before rendering.
- `src/lib/vault/frontmatter.ts`: `Frontmatter` type. `identifyOnStage` reads `frontmatter.faction` off each NPC `EntityDoc` to populate `factionsToSpawn`.

**Wave-2 outputs you depend on (already merged, do NOT modify):**

- `src/lib/vault/journal.ts`: `JournalEntry = { heading, body }`, `parseRecentEntries`. The narrator dossier embeds the formatted recent-journal block; the caller of `buildNarratorDossier` passes the `JournalEntry[]` directly so the builder stays pure.
- The rest of Wave 2 (`turnId`, `lock`, `stubs`, `threads`, `playtests`) is consumed by Wave 5 only.

**Tests-fixture you depend on (already created in Wave 1):** `tests/fixtures/test-vault/` — 2 factions, 3 NPCs (kessha has `faction: red-banner`), 2 locations, `style-guide.md` with a `## Visual` block, `journal.md` with three mixed-format headings including a `[[npcs/kessha|Kessha]]` mention on turn-001.

---

## Pre-flight check (informational — do NOT re-run if green)

Before starting, verify Wave 1 + Wave 2 are in fact in place. If anything below is missing or has drifted, **stop and report** rather than fix inline — those are separate tickets.

- [ ] **Verify Wave-1 + Wave-2 source files exist.**

```bash
ls src/lib/vault/{paths,frontmatter,xml,entities,wikilinks,turnId,lock,journal,stubs,threads,playtests}.ts
```

Expected: all 11 paths listed without error. If any are missing, abort and report.

- [ ] **Verify all existing tests pass on a clean tree.**

```bash
pnpm test --run
```

Expected: all existing tests green. If anything fails, abort — Wave 3 must build on a green baseline.

- [ ] **Verify the fixture vault is present and has the bits Wave 3 will read.**

```bash
ls tests/fixtures/test-vault/style-guide.md tests/fixtures/test-vault/journal.md \
   tests/fixtures/test-vault/npcs/kessha.md tests/fixtures/test-vault/factions/red-banner.md
```

Expected: all four files listed. If any missing, abort — Wave 1 fixture is incomplete.

- [ ] **Verify `ffmpeg` is on PATH (spec exit criterion for media).**

```bash
which ffmpeg
```

Expected: a non-empty path. If missing, install before continuing (`brew install ffmpeg` on macOS) — the spec's Error-matrix row "ffmpeg not on PATH" mandates fail-fast at server startup, so we cannot ship Wave 3 without it locally.

- [ ] **Verify the working tree is clean on the wave-3 branch.**

```bash
git status -uno && git rev-parse --abbrev-ref HEAD
```

Expected: clean tree, branch `auto/2026-05-10-mastra-rpg-runtime-port-design-wave-3`.

---

## File structure

Production files (all new):

| File                     | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/schemas.ts`     | Four Zod schemas + their inferred TypeScript types: `FactionOutput`, `NarratorOutput`, `IllustratorOutput`, `ImageMeta`. Exact shape per spec lines 143–172. No I/O, no dependency on `src/lib/vault/`. Importable by tools, agents, workflow, and dossier builders alike.                                                                                                                                                                           |
| `src/lib/dossier.ts`     | Pure functions assembling per-agent string inputs (XML-tag-bracketed sections) from pre-loaded vault state: `identifyOnStage(playerInput, recent, entities)`, `extractVisualBlock(styleGuide)`, `buildFactionDossier(input)`, `buildNarratorDossier(input)`, `buildIllustratorDossier(input)`. No `fs` reads; caller (the workflow in Wave 5) does all loading. Mirrors OpenClaw `rpg-narrator/buildDossier.py`.                                     |
| `src/lib/media/tts.ts`   | `ttsRender(text, options) → Promise<string>` that POSTs to Inworld TTS v2, base64-decodes the response into an MP3 buffer, pipes it through `ffmpeg` to an OGG Opus file at `options.output`, and returns the resolved absolute path. Injectable seams: `fetch` impl, `spawn` impl — so unit tests can stub both without monkey-patching globals.                                                                                                    |
| `src/lib/media/image.ts` | `generateImage({ prompt, slug, vaultRoot }) → Promise<ImageMeta>` that POSTs to OpenAI `/v1/images/generations` with `model: gpt-image-2`, base64-decodes the result, writes the PNG under `<vaultRoot>/images/<YYYYMMDD>-<HHMMSS>-<slug>-<6char-rand>.png`, and returns `{ filename, path, prompt, slug }` (matches `ImageMeta` schema). Same injectable seams as TTS. `buildFilename` is also exported for unit-level filename-pattern assertions. |

Test files (co-located):

| File                          | Responsibility                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/schemas.test.ts`     | Each schema accepts valid shapes and rejects the documented invalid shapes (empty `prose`, missing `decision`, etc.). `ImageMeta` validates the workflow contract end-to-end.                                                                                                                                                                        |
| `src/lib/dossier.test.ts`     | `extractVisualBlock` returns the right slice for the fixture style-guide (and `null` if missing). `identifyOnStage` is deterministic against a hand-built recent-journal + player-input + entities map (kessha on stage → `factionsToSpawn` includes `red-banner`, dedup correct). All three `build*Dossier` functions produce snapshot-stable text. |
| `src/lib/media/tts.test.ts`   | `ttsRender` calls the correct URL with the correct headers/body, handles 200 + audioContent decode → MP3 buffer → ffmpeg path, surfaces non-200 as a thrown error. Uses an injected `fetch` and `spawn`. One live-test gate (`describe.runIf`) guarded by `INWORLD_API_KEY` for the spec's "hello world" smoke.                                      |
| `src/lib/media/image.test.ts` | `buildFilename` matches the regex `^\d{8}-\d{6}-[a-z0-9-]+-[a-z0-9]{6}\.png$`; same slug twice produces different filenames; `generateImage` calls the correct OpenAI endpoint with the right body, writes the b64-decoded bytes to disk, returns the right `ImageMeta`. One live-test gate guarded by `OPENAI_API_KEY` for the spec's PNG smoke.    |

No new fixtures. The dossier tests synthesize their inputs inline (so test reviewers can see exactly what an `AlwaysLoaded`-shaped object looks like at the call site without chasing fixture files).

---

## Implementation order (TDD discipline)

Each task follows red-green-refactor explicitly: Step "Write the failing test" → "Run to verify it fails" → "Write minimal implementation" → "Run to verify it passes" → "Commit". Do not batch implementation ahead of tests.

Order (contracts first, then pure builders, then media wrappers; mirrors the spec's listed order in Wave 3 table):

1. **Task 1: `schemas.ts`** — leaf-most contract; everything else imports `ImageMeta`. Zod-only; no `fs`, no Mastra.
2. **Task 2: `dossier.ts`** — pure builders + on-stage detector + visual-block extractor. Imports `schemas.ts` only for one type (`ImageMeta` isn't needed; the dossier is text). Wave-1 types are imported but no `fs` calls are made.
3. **Task 3: `media/tts.ts`** — first wrapper to land; smaller surface than image. Establishes the "inject fetch + spawn" pattern that image.ts re-uses.
4. **Task 4: `media/image.ts`** — second wrapper; re-uses the inject-the-IO-boundary pattern from `tts.ts`. Includes the random-suffix filename helper (verifiable in isolation).
5. **Task 5: Coverage gate verification + final compile/lint check.**

Why this order: `schemas.ts` is a 5-minute task that unblocks the type imports in every following file. `dossier.ts` is the largest pure module; doing it before the media wrappers means a test-failure in the wrappers can never be confused with a regression in dossier output. The two media wrappers go last because they're the only files that touch the network and the disk; landing them after the pure modules keeps the "live test" gates contained.

---

## Task 1: `schemas.ts` — Zod contracts for the three agents + image meta

Spec lines 143–172 are precise on shape. We additionally export inferred TypeScript types so the rest of the codebase types against `FactionOutput` etc. rather than `z.infer<typeof FactionOutput>` everywhere. `ImageMeta` is the per-image record the illustrator returns and the workflow surfaces in the SSE `done` event (spec line 295 references `images: ImageMeta[]`).

**Files:**

- Create: `src/lib/schemas.ts`
- Test: `src/lib/schemas.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// src/lib/schemas.test.ts
import { describe, it, expect } from 'vitest';
import {
  FactionOutput,
  NarratorOutput,
  IllustratorOutput,
  ImageMeta,
  type FactionOutput as FactionOutputT,
  type NarratorOutput as NarratorOutputT,
  type IllustratorOutput as IllustratorOutputT,
  type ImageMeta as ImageMetaT,
} from './schemas';

describe('FactionOutput', () => {
  it('accepts a valid {decision, reasoning} object', () => {
    const ok: FactionOutputT = FactionOutput.parse({
      decision: 'Send envoys to the council.',
      reasoning: 'The faction values diplomacy over force in low-stakes contact.',
    });
    expect(ok.decision).toBe('Send envoys to the council.');
  });

  it('rejects empty decision', () => {
    expect(() => FactionOutput.parse({ decision: '', reasoning: 'r' })).toThrow();
  });

  it('rejects empty reasoning', () => {
    expect(() => FactionOutput.parse({ decision: 'd', reasoning: '' })).toThrow();
  });

  it('rejects missing fields', () => {
    expect(() => FactionOutput.parse({ decision: 'd' })).toThrow();
    expect(() => FactionOutput.parse({ reasoning: 'r' })).toThrow();
  });
});

describe('NarratorOutput', () => {
  it('accepts prose-only object (time_passed absent)', () => {
    const ok: NarratorOutputT = NarratorOutput.parse({ prose: 'The harbor wind picks up.' });
    expect(ok.prose).toContain('harbor');
    expect(ok.time_passed).toBeUndefined();
  });

  it('accepts prose + time_passed.days', () => {
    const ok = NarratorOutput.parse({ prose: 'X.', time_passed: { days: 1 } });
    expect(ok.time_passed?.days).toBe(1);
  });

  it('accepts prose + time_passed.hours', () => {
    const ok = NarratorOutput.parse({ prose: 'X.', time_passed: { hours: 6 } });
    expect(ok.time_passed?.hours).toBe(6);
  });

  it('rejects empty prose', () => {
    expect(() => NarratorOutput.parse({ prose: '' })).toThrow();
  });

  it('rejects negative days/hours', () => {
    expect(() => NarratorOutput.parse({ prose: 'X.', time_passed: { days: -1 } })).toThrow();
    expect(() => NarratorOutput.parse({ prose: 'X.', time_passed: { hours: -1 } })).toThrow();
  });

  it('rejects non-integer days/hours', () => {
    expect(() => NarratorOutput.parse({ prose: 'X.', time_passed: { days: 1.5 } })).toThrow();
  });
});

describe('ImageMeta', () => {
  it('accepts a fully-populated image record', () => {
    const ok: ImageMetaT = ImageMeta.parse({
      filename: '20260511-080700-kessha-abc123.png',
      path: '/vault/images/20260511-080700-kessha-abc123.png',
      prompt: 'Kessha at the helm.',
      slug: 'kessha',
    });
    expect(ok.filename.endsWith('.png')).toBe(true);
  });

  it('rejects missing fields', () => {
    expect(() => ImageMeta.parse({ filename: 'a.png', path: '/a.png', prompt: 'x' })).toThrow();
  });
});

describe('IllustratorOutput', () => {
  it('accepts prose_with_embeds plus an empty images array', () => {
    const ok: IllustratorOutputT = IllustratorOutput.parse({
      prose_with_embeds: 'Body without embeds.',
      images: [],
    });
    expect(ok.images).toHaveLength(0);
  });

  it('accepts prose_with_embeds plus one image', () => {
    const ok = IllustratorOutput.parse({
      prose_with_embeds: 'Body with ![[a.png]].',
      images: [
        {
          filename: 'a.png',
          path: '/vault/images/a.png',
          prompt: 'p',
          slug: 's',
        },
      ],
    });
    expect(ok.images[0].slug).toBe('s');
  });

  it('rejects empty prose_with_embeds', () => {
    expect(() => IllustratorOutput.parse({ prose_with_embeds: '', images: [] })).toThrow();
  });

  it('rejects a malformed image in the array', () => {
    expect(() =>
      IllustratorOutput.parse({
        prose_with_embeds: 'X.',
        images: [{ filename: 'a.png' }],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm test --run src/lib/schemas.test.ts
```

Expected: FAIL with `Cannot find module './schemas'`.

- [ ] **Step 3: Write the minimal implementation.**

```ts
// src/lib/schemas.ts
import { z } from 'zod';

/**
 * Output schemas for the three agents and the per-image record they produce.
 * Spec lines 143-172. These are the I/O contracts between the workflow
 * (src/mastra/workflows/turn.ts, Wave 5) and the agents (Wave 4); also
 * consumed by the SSE serializer in src/app/api/turn/route.ts (Wave 6).
 *
 * Inferred TypeScript types are re-exported so callers can write
 *   import type { NarratorOutput } from '@/lib/schemas';
 * without invoking `z.infer<typeof ...>` themselves.
 */

export const FactionOutput = z.object({
  decision: z.string().min(1),
  reasoning: z.string().min(1),
});
export type FactionOutput = z.infer<typeof FactionOutput>;

export const NarratorOutput = z.object({
  prose: z.string().min(1),
  time_passed: z
    .object({
      days: z.number().int().nonnegative().optional(),
      hours: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
export type NarratorOutput = z.infer<typeof NarratorOutput>;

export const ImageMeta = z.object({
  filename: z.string().min(1),
  path: z.string().min(1),
  prompt: z.string().min(1),
  slug: z.string().min(1),
});
export type ImageMeta = z.infer<typeof ImageMeta>;

export const IllustratorOutput = z.object({
  prose_with_embeds: z.string().min(1),
  images: z.array(ImageMeta),
});
export type IllustratorOutput = z.infer<typeof IllustratorOutput>;
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
pnpm test --run src/lib/schemas.test.ts
```

Expected: all 16 tests PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/schemas.ts src/lib/schemas.test.ts
git commit -m "$(cat <<'EOF'
feat(schemas): Zod contracts for faction, narrator, illustrator, image

Adds src/lib/schemas.ts with the four Zod schemas the workflow uses to
validate agent I/O: FactionOutput {decision, reasoning}, NarratorOutput
{prose, time_passed?}, IllustratorOutput {prose_with_embeds, images},
ImageMeta {filename, path, prompt, slug}. Each schema's inferred
TypeScript type is re-exported for direct consumer imports.

Mirrors the Zod block in the spec (lines 143-172) verbatim and enforces
the documented constraints (non-empty strings, non-negative integer
days/hours).
EOF
)"
```

---

## Task 2: `dossier.ts` — pure builders + on-stage detector + visual-block extractor

Spec lines 177–262 spell out the per-step inputs each agent gets. The dossier is XML-tag-bracketed text (matches OpenClaw's `<world>`, `<character>`, `<recent_journal>` framing — see `/Users/valentin/Development/ai/maz_rpg/openclaw/skills/rpg-narrator/scripts/` for the prior-art template) because the LLM tokenizers respect those boundaries reliably and reviewers can grep the dossier in playtest logs.

`identifyOnStage` is **deterministic** per spec line 192: it returns the list of NPCs whose slug appears in the latest player input or any of the recent journal entries. The spec line 188 narrows the faction-spawn list to "on-stage NPCs with `faction:` frontmatter", which we compute inside the same function and return alongside.

`extractVisualBlock` is the `## Visual` regex from OpenClaw `image.py` line 45 — verbatim. The illustrator dossier embeds it; the image tool also re-uses this helper later in Wave 4 (the workflow loads `style-guide.md` once and passes the block down).

**Files:**

- Create: `src/lib/dossier.ts`
- Test: `src/lib/dossier.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// src/lib/dossier.test.ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  extractVisualBlock,
  identifyOnStage,
  buildFactionDossier,
  buildNarratorDossier,
  buildIllustratorDossier,
  type OnStage,
} from './dossier';
import type { EntityDoc } from './vault/entities';
import type { WorldView, CharacterView, ThreadView } from './vault/xml';
import type { JournalEntry } from './vault/journal';

const FIXTURE = 'tests/fixtures/test-vault';

// ---- shared fixture builders ---------------------------------------------

function world(): WorldView {
  return {
    date: '7 ABY, Month 4, Standard Day 20',
    calendar: 'GSC',
    region: 'Test Region',
    city: 'Test City',
    placeSlug: 'iron-promise',
    weather: 'Clear, cold.',
    season: 'Test season.',
    notes: ['A test note.'],
  };
}

function character(): CharacterView {
  return {
    name: 'Test Captain',
    age: '40',
    role: 'test captain',
    background: 'A test background.',
    skills: 'Test skills.',
    inventory: [{ significance: 'key', text: 'Test item' }],
    wealth: 'strapped',
    reputation: [{ slug: 'red-banner', text: 'tolerated' }],
    relationships: [{ slug: 'kessha', text: 'first mate' }],
  };
}

function threads(): ThreadView[] {
  return [{ id: 'fresh-clock', name: 'Fresh Clock', stake: 's', progress: '1/8', trigger: 't' }];
}

function kessha(): EntityDoc {
  return {
    slug: 'kessha',
    frontmatter: { aliases: ['Kessha', 'the navigator'], tags: ['npc'], faction: 'red-banner' },
    body: '# Kessha\n\nNavigator and aide.',
  };
}

function loneWolf(): EntityDoc {
  return {
    slug: 'lone-wolf',
    frontmatter: { aliases: ['Lone Wolf'], tags: ['npc'] },
    body: '# Lone Wolf\n\nUnaffiliated.',
  };
}

function ironPromise(): EntityDoc {
  return {
    slug: 'iron-promise',
    frontmatter: { aliases: ['the ship'], tags: ['location'] },
    body: '# Iron Promise\n\nA ship.',
  };
}

function redBanner(): EntityDoc {
  return {
    slug: 'red-banner',
    frontmatter: { aliases: ['Red Banner'], tags: ['faction'] },
    body: '# Red Banner\n\nA syndicate.',
  };
}

function recentJournal(): JournalEntry[] {
  return [
    {
      heading: '7 ABY, Month 4, Standard Day 18 — turn-001',
      body: 'Turn-001 prose mentions [[npcs/kessha|Kessha]] and [[locations/iron-promise]].',
    },
    {
      heading: 'Turn 002 - 7 ABY, Month 4, Day 19',
      body: 'Quiet beat.',
    },
  ];
}

// ---- extractVisualBlock --------------------------------------------------

describe('extractVisualBlock', () => {
  it('returns the body of ## Visual from the fixture style-guide', async () => {
    const raw = await fs.readFile(path.join(FIXTURE, 'style-guide.md'), 'utf8');
    const block = extractVisualBlock(raw);
    expect(block).toBe('Test visual block. One sentence.');
  });

  it('returns null when ## Visual is missing', () => {
    expect(extractVisualBlock('# Style Guide\n\n## Tone\n\nOnly tone.\n')).toBeNull();
  });

  it('captures up to the next ## heading', () => {
    const src = '# x\n\n## Visual\n\nFirst block.\nSecond line.\n\n## After\n\nIgnored.';
    expect(extractVisualBlock(src)).toBe('First block.\nSecond line.');
  });

  it('captures up to EOF when no following ## heading exists', () => {
    const src = '# x\n\n## Visual\n\nOnly block.\nMultiple lines.';
    expect(extractVisualBlock(src)).toBe('Only block.\nMultiple lines.');
  });
});

// ---- identifyOnStage -----------------------------------------------------

describe('identifyOnStage', () => {
  it('flags an NPC mentioned in the player input by alias', () => {
    const out = identifyOnStage({
      playerInput: 'I greet Kessha at the gangway.',
      recent: [],
      entities: [kessha(), loneWolf(), ironPromise()],
    });
    expect(out.npcs.map((n) => n.slug)).toEqual(['kessha']);
    expect(out.factionsToSpawn).toEqual(['red-banner']);
  });

  it('flags an NPC mentioned in recent journal via folder-prefixed wikilink', () => {
    const out = identifyOnStage({
      playerInput: 'I look around.',
      recent: recentJournal(),
      entities: [kessha(), loneWolf(), ironPromise()],
    });
    expect(out.npcs.map((n) => n.slug)).toContain('kessha');
    expect(out.factionsToSpawn).toEqual(['red-banner']);
  });

  it('does NOT spawn a faction for an on-stage NPC without faction frontmatter', () => {
    const out = identifyOnStage({
      playerInput: 'Lone Wolf nods.',
      recent: [],
      entities: [loneWolf()],
    });
    expect(out.npcs.map((n) => n.slug)).toEqual(['lone-wolf']);
    expect(out.factionsToSpawn).toEqual([]);
  });

  it('dedupes factions when two on-stage NPCs share a faction', () => {
    const otherRedNpc: EntityDoc = {
      slug: 'red-second',
      frontmatter: { aliases: ['Red Two'], tags: ['npc'], faction: 'red-banner' },
      body: '',
    };
    const out = identifyOnStage({
      playerInput: 'Kessha and Red Two are here.',
      recent: [],
      entities: [kessha(), otherRedNpc],
    });
    expect(out.npcs.map((n) => n.slug).sort()).toEqual(['kessha', 'red-second']);
    expect(out.factionsToSpawn).toEqual(['red-banner']);
  });

  it('returns locations separately from npcs', () => {
    const out = identifyOnStage({
      playerInput: 'I board the [[locations/iron-promise]].',
      recent: [],
      entities: [kessha(), ironPromise()],
    });
    expect(out.locations.map((l) => l.slug)).toEqual(['iron-promise']);
    expect(out.npcs).toEqual([]);
    expect(out.factionsToSpawn).toEqual([]);
  });

  it('returns empty arrays for a "player is alone" beat', () => {
    const out: OnStage = identifyOnStage({
      playerInput: 'I sit and think.',
      recent: [{ heading: 'h', body: 'nothing here' }],
      entities: [kessha(), loneWolf(), ironPromise()],
    });
    expect(out.npcs).toEqual([]);
    expect(out.locations).toEqual([]);
    expect(out.factionsToSpawn).toEqual([]);
  });

  it('matches alias case-insensitively (kessha ≠ KESSHA in user input)', () => {
    const out = identifyOnStage({
      playerInput: 'KESSHA is here.',
      recent: [],
      entities: [kessha()],
    });
    expect(out.npcs.map((n) => n.slug)).toEqual(['kessha']);
  });
});

// ---- buildFactionDossier -------------------------------------------------

describe('buildFactionDossier', () => {
  it('renders the full faction prompt with all required sections', () => {
    const out = identifyOnStage({
      playerInput: 'I greet Kessha.',
      recent: [],
      entities: [kessha(), loneWolf()],
    });
    const dossier = buildFactionDossier({
      faction: redBanner(),
      onStage: out,
      recent: recentJournal(),
      world: world(),
      character: character(),
      playerInput: 'I greet Kessha.',
    });
    expect(dossier).toContain('<world>');
    expect(dossier).toContain('7 ABY, Month 4, Standard Day 20');
    expect(dossier).toContain('<character>');
    expect(dossier).toContain('Test Captain');
    expect(dossier).toContain('<faction slug="red-banner">');
    expect(dossier).toContain('Red Banner');
    expect(dossier).toContain('<on_stage>');
    expect(dossier).toContain('kessha');
    expect(dossier).toContain('<recent_journal>');
    expect(dossier).toContain('Turn-001 prose mentions');
    expect(dossier).toContain('<player_input>');
    expect(dossier).toContain('I greet Kessha.');
  });

  it('is a pure function (same inputs → same output)', () => {
    const a = buildFactionDossier({
      faction: redBanner(),
      onStage: { npcs: [], locations: [], factionsToSpawn: [] },
      recent: [],
      world: world(),
      character: character(),
      playerInput: 'x',
    });
    const b = buildFactionDossier({
      faction: redBanner(),
      onStage: { npcs: [], locations: [], factionsToSpawn: [] },
      recent: [],
      world: world(),
      character: character(),
      playerInput: 'x',
    });
    expect(a).toBe(b);
  });
});

// ---- buildNarratorDossier ------------------------------------------------

describe('buildNarratorDossier', () => {
  it('renders narrator-specific sections including faction_decisions', () => {
    const dossier = buildNarratorDossier({
      world: world(),
      character: character(),
      threads: threads(),
      styleGuide: '# Style Guide\n\n## Tone\n\nClipped.\n',
      onStage: {
        npcs: [kessha()],
        locations: [ironPromise()],
        factionsToSpawn: ['red-banner'],
      },
      recent: recentJournal(),
      factionDecisions: [{ slug: 'red-banner', decision: 'Send envoys.' }],
      playerInput: 'I greet Kessha.',
      turnId: 'turn-042',
    });
    expect(dossier).toContain('<world>');
    expect(dossier).toContain('<character>');
    expect(dossier).toContain('<threads>');
    expect(dossier).toContain('fresh-clock');
    expect(dossier).toContain('<style_guide>');
    expect(dossier).toContain('Clipped.');
    expect(dossier).toContain('<on_stage>');
    expect(dossier).toContain('kessha');
    expect(dossier).toContain('<recent_journal>');
    expect(dossier).toContain('<faction_decisions>');
    expect(dossier).toContain('Send envoys.');
    expect(dossier).toContain('<player_input>');
    expect(dossier).toContain('I greet Kessha.');
    expect(dossier).toContain('turn-042');
  });

  it('handles empty faction_decisions cleanly (the alone case)', () => {
    const dossier = buildNarratorDossier({
      world: world(),
      character: character(),
      threads: [],
      styleGuide: '',
      onStage: { npcs: [], locations: [], factionsToSpawn: [] },
      recent: [],
      factionDecisions: [],
      playerInput: 'I sit alone.',
      turnId: 'turn-001',
    });
    expect(dossier).toContain('<faction_decisions></faction_decisions>');
    expect(dossier).toContain('I sit alone.');
  });
});

// ---- buildIllustratorDossier ---------------------------------------------

describe('buildIllustratorDossier', () => {
  it('embeds the visual block + prose + on-stage entities', () => {
    const dossier = buildIllustratorDossier({
      narratorProse: 'The harbor wind carries the smell of pitch.',
      styleGuideVisual: 'Test visual block. One sentence.',
      onStage: {
        npcs: [kessha()],
        locations: [ironPromise()],
        factionsToSpawn: ['red-banner'],
      },
    });
    expect(dossier).toContain('<visual_style>');
    expect(dossier).toContain('Test visual block.');
    expect(dossier).toContain('<narrator_prose>');
    expect(dossier).toContain('harbor wind');
    expect(dossier).toContain('<on_stage>');
    expect(dossier).toContain('kessha');
    expect(dossier).toContain('iron-promise');
  });

  it('omits <visual_style> contents when style guide had no ## Visual block', () => {
    const dossier = buildIllustratorDossier({
      narratorProse: 'X.',
      styleGuideVisual: '',
      onStage: { npcs: [], locations: [], factionsToSpawn: [] },
    });
    expect(dossier).toContain('<visual_style></visual_style>');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm test --run src/lib/dossier.test.ts
```

Expected: FAIL with `Cannot find module './dossier'`.

- [ ] **Step 3: Write the minimal implementation.**

```ts
// src/lib/dossier.ts
import type { EntityDoc } from './vault/entities';
import type { WorldView, CharacterView, ThreadView } from './vault/xml';
import type { JournalEntry } from './vault/journal';
import { parseWikilinks } from './vault/wikilinks';

// ---- types --------------------------------------------------------------

export interface OnStage {
  npcs: EntityDoc[];
  locations: EntityDoc[];
  /** Deduped faction slugs spawned by the on-stage NPCs. */
  factionsToSpawn: string[];
}

export interface IdentifyOnStageInput {
  playerInput: string;
  recent: JournalEntry[];
  /** All currently-loaded entities (npcs + locations + factions). */
  entities: EntityDoc[];
}

export interface BuildFactionDossierInput {
  faction: EntityDoc;
  onStage: OnStage;
  recent: JournalEntry[];
  world: WorldView;
  character: CharacterView;
  playerInput: string;
}

export interface BuildNarratorDossierInput {
  world: WorldView;
  character: CharacterView;
  threads: ThreadView[];
  styleGuide: string;
  onStage: OnStage;
  recent: JournalEntry[];
  factionDecisions: { slug: string; decision: string }[];
  playerInput: string;
  turnId: string;
}

export interface BuildIllustratorDossierInput {
  narratorProse: string;
  /** The ## Visual block text only (no heading). Caller calls extractVisualBlock first. */
  styleGuideVisual: string;
  onStage: OnStage;
}

// ---- extractVisualBlock --------------------------------------------------

/**
 * Returns the body of the `## Visual` section in a style-guide markdown,
 * stripped of leading/trailing whitespace. Returns `null` if the section
 * is absent. Mirrors OpenClaw `image.py:_VISUAL_RE` verbatim.
 */
const VISUAL_RE = /^## Visual\s*\n([\s\S]*?)(?=^## |\Z(?![\s\S]))/m;

export function extractVisualBlock(styleGuide: string): string | null {
  const m = styleGuide.match(VISUAL_RE);
  if (!m) return null;
  return m[1].trim();
}

// ---- identifyOnStage -----------------------------------------------------

/**
 * Deterministic on-stage detector. An NPC or location is "on stage" if:
 *  - its slug appears as a wikilink target in the player input or any recent
 *    journal entry (`[[npcs/foo]]`, `[[locations/bar]]`), OR
 *  - any of its aliases (case-insensitive substring match on a word boundary)
 *    appears in the player input or recent journal text.
 *
 * `factionsToSpawn` = deduped list of `npcs[i].frontmatter.faction` strings
 * for every on-stage NPC that has one. Order is the insertion order of first
 * encounter, so the workflow's parallel fan-out is deterministic.
 */
export function identifyOnStage(input: IdentifyOnStageInput): OnStage {
  const haystack = [input.playerInput, ...input.recent.map((e) => e.heading + '\n' + e.body)].join(
    '\n',
  );
  const haystackLower = haystack.toLowerCase();
  const links = parseWikilinks(haystack).map((l) => l.target.toLowerCase());

  const npcs: EntityDoc[] = [];
  const locations: EntityDoc[] = [];
  for (const e of input.entities) {
    const tags = Array.isArray(e.frontmatter.tags) ? (e.frontmatter.tags as string[]) : [];
    const kind = tags.includes('npc') ? 'npc' : tags.includes('location') ? 'location' : null;
    if (kind === null) continue;
    const folder = kind === 'npc' ? 'npcs' : 'locations';
    const linkMatch = links.some((t) => t === `${folder}/${e.slug}` || t === e.slug);
    const aliasMatch = aliasHit(haystackLower, e);
    if (!linkMatch && !aliasMatch) continue;
    (kind === 'npc' ? npcs : locations).push(e);
  }

  const seen = new Set<string>();
  const factionsToSpawn: string[] = [];
  for (const n of npcs) {
    const f = n.frontmatter.faction;
    if (typeof f !== 'string' || f.length === 0) continue;
    if (seen.has(f)) continue;
    seen.add(f);
    factionsToSpawn.push(f);
  }

  return { npcs, locations, factionsToSpawn };
}

function aliasHit(haystackLower: string, entity: EntityDoc): boolean {
  const aliases = Array.isArray(entity.frontmatter.aliases)
    ? (entity.frontmatter.aliases as string[])
    : [];
  for (const a of aliases) {
    if (a.length === 0) continue;
    const re = new RegExp(`\\b${escapeRegex(a.toLowerCase())}\\b`);
    if (re.test(haystackLower)) return true;
  }
  return false;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---- dossier builders ----------------------------------------------------

/**
 * Build the per-faction prompt. Mirrors OpenClaw's faction skill input:
 * world, character, faction body, on-stage entities, recent journal,
 * the player input. The faction agent returns { decision, reasoning }.
 */
export function buildFactionDossier(input: BuildFactionDossierInput): string {
  return [
    `<world calendar="${esc(input.world.calendar)}" date="${esc(input.world.date)}">`,
    renderWorld(input.world),
    `</world>`,
    `<character>`,
    renderCharacter(input.character),
    `</character>`,
    `<faction slug="${esc(input.faction.slug)}">`,
    input.faction.body.trim(),
    `</faction>`,
    `<on_stage>`,
    renderOnStage(input.onStage),
    `</on_stage>`,
    `<recent_journal>`,
    renderJournal(input.recent),
    `</recent_journal>`,
    `<player_input>${input.playerInput.trim()}</player_input>`,
  ].join('\n');
}

/**
 * Build the narrator prompt. Adds threads, style guide, and the faction
 * decisions returned by Step 2 of the workflow.
 */
export function buildNarratorDossier(input: BuildNarratorDossierInput): string {
  return [
    `<turn id="${esc(input.turnId)}">`,
    `<world calendar="${esc(input.world.calendar)}" date="${esc(input.world.date)}">`,
    renderWorld(input.world),
    `</world>`,
    `<character>`,
    renderCharacter(input.character),
    `</character>`,
    `<threads>`,
    renderThreads(input.threads),
    `</threads>`,
    `<style_guide>${input.styleGuide.trim()}</style_guide>`,
    `<on_stage>`,
    renderOnStage(input.onStage),
    `</on_stage>`,
    `<recent_journal>`,
    renderJournal(input.recent),
    `</recent_journal>`,
    `<faction_decisions>${renderDecisions(input.factionDecisions)}</faction_decisions>`,
    `<player_input>${input.playerInput.trim()}</player_input>`,
    `</turn>`,
  ].join('\n');
}

/**
 * Build the illustrator prompt: the ## Visual block, the narrator's prose,
 * and the on-stage entities (so the illustrator can pick at most a few
 * scenes and embed them as ![[file.png]] using the image tool).
 */
export function buildIllustratorDossier(input: BuildIllustratorDossierInput): string {
  return [
    `<visual_style>${input.styleGuideVisual.trim()}</visual_style>`,
    `<narrator_prose>${input.narratorProse.trim()}</narrator_prose>`,
    `<on_stage>`,
    renderOnStage(input.onStage),
    `</on_stage>`,
  ].join('\n');
}

// ---- private renderers ---------------------------------------------------

function renderWorld(w: WorldView): string {
  const lines = [
    `  <region>${esc(w.region)}</region>`,
    `  <city>${esc(w.city)}</city>`,
    `  <place slug="${esc(w.placeSlug)}"></place>`,
    `  <weather>${esc(w.weather)}</weather>`,
    `  <season>${esc(w.season)}</season>`,
  ];
  for (const note of w.notes) lines.push(`  <note>${esc(note)}</note>`);
  return lines.join('\n');
}

function renderCharacter(c: CharacterView): string {
  const lines = [
    `  <name>${esc(c.name)}</name>`,
    `  <age>${esc(c.age)}</age>`,
    `  <role>${esc(c.role)}</role>`,
    `  <background>${esc(c.background)}</background>`,
    `  <skills>${esc(c.skills)}</skills>`,
    `  <wealth>${esc(c.wealth)}</wealth>`,
  ];
  for (const item of c.inventory) {
    lines.push(`  <item significance="${esc(item.significance)}">${esc(item.text)}</item>`);
  }
  for (const r of c.reputation) {
    lines.push(`  <reputation slug="${esc(r.slug)}">${esc(r.text)}</reputation>`);
  }
  for (const rel of c.relationships) {
    lines.push(`  <relationship slug="${esc(rel.slug)}">${esc(rel.text)}</relationship>`);
  }
  return lines.join('\n');
}

function renderThreads(threads: ThreadView[]): string {
  return threads
    .map(
      (t) =>
        `  <thread id="${esc(t.id)}"><name>${esc(t.name)}</name><progress>${esc(t.progress)}</progress><stake>${esc(t.stake)}</stake></thread>`,
    )
    .join('\n');
}

function renderOnStage(on: OnStage): string {
  const lines: string[] = [];
  for (const n of on.npcs) {
    const f =
      typeof n.frontmatter.faction === 'string' ? ` faction="${esc(n.frontmatter.faction)}"` : '';
    lines.push(`  <npc slug="${esc(n.slug)}"${f}>${esc(n.body.trim())}</npc>`);
  }
  for (const l of on.locations) {
    lines.push(`  <location slug="${esc(l.slug)}">${esc(l.body.trim())}</location>`);
  }
  return lines.join('\n');
}

function renderJournal(recent: JournalEntry[]): string {
  return recent
    .map((e) => `  <entry heading="${esc(e.heading)}">${esc(e.body.trim())}</entry>`)
    .join('\n');
}

function renderDecisions(decisions: { slug: string; decision: string }[]): string {
  if (decisions.length === 0) return '';
  return (
    '\n' +
    decisions
      .map((d) => `  <decision faction="${esc(d.slug)}">${esc(d.decision.trim())}</decision>`)
      .join('\n') +
    '\n'
  );
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
pnpm test --run src/lib/dossier.test.ts
```

Expected: all 17 tests PASS. If `identifyOnStage` returns extra entries due to over-eager alias matching (e.g. "the" matches everywhere), tighten `aliasHit` to require alias length ≥ 3 and re-run. If `extractVisualBlock` regex fails on the "no following ## heading, no trailing newline" case, replace the lookahead with `(?=^## |$)` and test again.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/dossier.ts src/lib/dossier.test.ts
git commit -m "$(cat <<'EOF'
feat(dossier): pure builders for faction, narrator, illustrator inputs

Adds src/lib/dossier.ts. Five exports:
- extractVisualBlock(styleGuide) — mirrors OpenClaw image.py _VISUAL_RE
- identifyOnStage(playerInput, recent, entities) — deterministic on-stage
  NPC/location detection via folder-prefixed wikilinks + alias matching,
  returns deduped factionsToSpawn from on-stage NPCs' faction frontmatter
- buildFactionDossier, buildNarratorDossier, buildIllustratorDossier —
  pure string builders emitting XML-tag-bracketed agent inputs

No I/O. All loading is the caller's responsibility (workflow Wave 5
passes pre-loaded AlwaysLoaded + recent JournalEntry[]).
EOF
)"
```

---

## Task 3: `media/tts.ts` — Inworld TTS v2 → mp3 → ffmpeg → ogg

Spec lines 537–543 require a non-empty `.ogg` for "hello world" and design the module so unit tests can stub. OpenClaw's `tts.sh` (lines 80–102) defines the on-the-wire contract: POST `https://api.inworld.ai/tts/v1/voice` with `Authorization: Basic $INWORLD_API_KEY`, body `{ voiceId, modelId: 'inworld-tts-1.5-max', text, speed?, temperature? }`, response `{ audioContent: <base64 mp3> }`. We then pipe the decoded MP3 through `ffmpeg -i - -c:a libopus -b:a 64k <out.ogg>`.

The design pattern for stubbability is "inject the IO boundary as an options field, default to the global". The module exports a single function `ttsRender(text, options)` plus the `TtsDeps` interface for tests to pass in a custom `fetch` and `spawn`. Spec Error-matrix row "ffmpeg not on PATH" (line 339) says we fail fast at server startup — the runtime check is the workflow's responsibility (Wave 5); `tts.ts` itself trusts that `ffmpeg` is present and reports the spawn error if it isn't.

**Files:**

- Create: `src/lib/media/tts.ts`
- Test: `src/lib/media/tts.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// src/lib/media/tts.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { ttsRender, type TtsDeps } from './tts';

const SAMPLE_B64 = Buffer.from('fake-mp3-bytes').toString('base64');

function makeFakeFetch(status = 200, body: unknown = { audioContent: SAMPLE_B64 }) {
  return vi.fn(async (url: string, init: RequestInit) => {
    const res = {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Bad',
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
    void url;
    void init;
    return res;
  });
}

/**
 * Fake "ffmpeg" child process: reads stdin, writes "<input>-as-ogg" to the
 * output path passed via argv, then emits `close` with code 0.
 */
function makeFakeSpawn() {
  return vi.fn((cmd: string, args: string[]) => {
    expect(cmd).toBe('ffmpeg');
    const outArg = args[args.length - 1];
    const ee = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stderr: EventEmitter;
      kill: () => void;
    };
    const collected: Buffer[] = [];
    ee.stdin = new Writable({
      write(chunk, _enc, cb) {
        collected.push(chunk as Buffer);
        cb();
      },
      final(cb) {
        // simulate ffmpeg writing an ogg file
        void fs
          .writeFile(outArg, Buffer.concat([...collected, Buffer.from('-as-ogg')]))
          .then(() => {
            ee.emit('close', 0);
            cb();
          })
          .catch(cb);
      },
    });
    ee.stderr = new EventEmitter();
    ee.kill = () => undefined;
    return ee;
  });
}

async function tmpOgg(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-tts-'));
  return path.join(dir, 'out.ogg');
}

describe('ttsRender', () => {
  it('POSTs to Inworld with the right URL, headers, and body', async () => {
    const fetchFn = makeFakeFetch();
    const spawnFn = makeFakeSpawn();
    const out = await tmpOgg();
    const deps: TtsDeps = { fetch: fetchFn as unknown as typeof fetch, spawn: spawnFn };

    await ttsRender('hello world', {
      voice: 'Hank',
      output: out,
      apiKey: 'secret',
      deps,
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.inworld.ai/tts/v1/voice');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Basic secret');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body.voiceId).toBe('Hank');
    expect(body.modelId).toBe('inworld-tts-1.5-max');
    expect(body.text).toBe('hello world');
  });

  it('writes a non-empty .ogg file and returns its absolute path', async () => {
    const fetchFn = makeFakeFetch();
    const spawnFn = makeFakeSpawn();
    const out = await tmpOgg();
    const deps: TtsDeps = { fetch: fetchFn as unknown as typeof fetch, spawn: spawnFn };

    const returned = await ttsRender('hello world', {
      voice: 'Hank',
      output: out,
      apiKey: 'k',
      deps,
    });
    expect(returned).toBe(out);
    const stat = await fs.stat(out);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('throws on a non-200 Inworld response with the status code in the message', async () => {
    const fetchFn = makeFakeFetch(500, { error: 'server boom' });
    const spawnFn = makeFakeSpawn();
    const out = await tmpOgg();
    const deps: TtsDeps = { fetch: fetchFn as unknown as typeof fetch, spawn: spawnFn };

    await expect(
      ttsRender('hello', { voice: 'Hank', output: out, apiKey: 'k', deps }),
    ).rejects.toThrow(/500/);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('throws when ffmpeg exits non-zero', async () => {
    const fetchFn = makeFakeFetch();
    const spawnFn = vi.fn(() => {
      const ee = new EventEmitter() as EventEmitter & {
        stdin: Writable;
        stderr: EventEmitter;
        kill: () => void;
      };
      ee.stdin = new Writable({
        write(_c, _e, cb) {
          cb();
        },
        final(cb) {
          ee.emit('close', 7);
          cb();
        },
      });
      ee.stderr = new EventEmitter();
      ee.kill = () => undefined;
      return ee;
    });
    const out = await tmpOgg();
    const deps: TtsDeps = { fetch: fetchFn as unknown as typeof fetch, spawn: spawnFn };

    await expect(
      ttsRender('hello', { voice: 'Hank', output: out, apiKey: 'k', deps }),
    ).rejects.toThrow(/ffmpeg/i);
  });

  it('throws when API key is missing (no apiKey arg + no env var)', async () => {
    const prev = process.env.INWORLD_API_KEY;
    delete process.env.INWORLD_API_KEY;
    const out = await tmpOgg();
    try {
      await expect(ttsRender('hello', { voice: 'Hank', output: out })).rejects.toThrow(
        /INWORLD_API_KEY/,
      );
    } finally {
      if (prev !== undefined) process.env.INWORLD_API_KEY = prev;
    }
  });
});

// Live smoke — gated on env var presence. Spec exit criterion line 543.
// Run manually with `INWORLD_API_KEY=... pnpm test src/lib/media/tts.test.ts`.
describe.runIf(!!process.env.INWORLD_API_KEY)('ttsRender — live smoke', () => {
  it('produces a non-empty .ogg for "hello world"', async () => {
    const out = await tmpOgg();
    const returned = await ttsRender('hello world', { voice: 'Hank', output: out });
    expect(returned).toBe(out);
    const stat = await fs.stat(out);
    expect(stat.size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm test --run src/lib/media/tts.test.ts
```

Expected: FAIL with `Cannot find module './tts'`.

- [ ] **Step 3: Write the minimal implementation.**

```ts
// src/lib/media/tts.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn as realSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

const INWORLD_URL = 'https://api.inworld.ai/tts/v1/voice';
const INWORLD_MODEL = 'inworld-tts-1.5-max';

/**
 * Dependency seams so unit tests can stub the network and the child process
 * without monkey-patching globals. Defaults to the real `fetch` and
 * `child_process.spawn`.
 */
export interface TtsDeps {
  fetch?: typeof fetch;
  spawn?: typeof realSpawn | ((cmd: string, args: string[]) => ChildProcessWithoutNullStreams);
}

export interface TtsOptions {
  /** Inworld voice id. Default: `'Hank'`. */
  voice?: string;
  /** Absolute path the final `.ogg` should be written to. Required. */
  output: string;
  /** Inworld API key. Defaults to `process.env.INWORLD_API_KEY`. */
  apiKey?: string;
  /** Per-request speed; passed through to Inworld if set. */
  speed?: number;
  /** Per-request temperature; passed through to Inworld if set. */
  temperature?: number;
  deps?: TtsDeps;
}

/**
 * Render `text` to an OGG Opus file at `options.output` via Inworld TTS v2
 * (returns the absolute path on success). Two-stage pipeline:
 *
 *  1. POST text → Inworld → base64 MP3 audio.
 *  2. Pipe MP3 → ffmpeg → OGG Opus at `options.output`.
 *
 * Throws on Inworld non-200, on JSON shape mismatch, or on ffmpeg failure.
 * Mirrors OpenClaw `inworld-tts/scripts/tts.sh`.
 */
export async function ttsRender(text: string, options: TtsOptions): Promise<string> {
  const apiKey = options.apiKey ?? process.env.INWORLD_API_KEY;
  if (!apiKey) {
    throw new Error('ttsRender: missing INWORLD_API_KEY (pass apiKey or set env var)');
  }
  const voice = options.voice ?? 'Hank';
  const fetchFn = options.deps?.fetch ?? fetch;
  const spawnFn = options.deps?.spawn ?? realSpawn;

  // 1) Inworld → base64 MP3 bytes.
  const body: Record<string, unknown> = {
    voiceId: voice,
    modelId: INWORLD_MODEL,
    text,
  };
  if (typeof options.speed === 'number') body.speed = options.speed;
  if (typeof options.temperature === 'number') body.temperature = options.temperature;

  const res = await fetchFn(INWORLD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await safeText(res);
    throw new Error(`ttsRender: Inworld returned HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as { audioContent?: string };
  if (typeof json.audioContent !== 'string' || json.audioContent.length === 0) {
    throw new Error('ttsRender: Inworld response missing audioContent');
  }
  const mp3 = Buffer.from(json.audioContent, 'base64');

  // 2) Pipe through ffmpeg → OGG Opus at options.output.
  await fs.mkdir(path.dirname(options.output), { recursive: true });
  await pipeThroughFfmpeg(mp3, options.output, spawnFn);
  return options.output;
}

async function pipeThroughFfmpeg(
  mp3: Buffer,
  outputPath: string,
  spawnFn: NonNullable<TtsDeps['spawn']>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawnFn('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      '-',
      '-c:a',
      'libopus',
      '-b:a',
      '64k',
      outputPath,
    ]) as ChildProcessWithoutNullStreams;

    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ttsRender: ffmpeg exited ${code}: ${stderr.slice(0, 200)}`));
    });
    child.on('error', (err) => reject(err));
    child.stdin.end(mp3);
  });
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
pnpm test --run src/lib/media/tts.test.ts
```

Expected: all 5 unit tests PASS. The live-smoke `describe.runIf` is skipped unless `INWORLD_API_KEY` is set.

- [ ] **Step 5: Run the live smoke (spec exit criterion).**

If `INWORLD_API_KEY` is available, run:

```bash
INWORLD_API_KEY=$INWORLD_API_KEY pnpm test --run src/lib/media/tts.test.ts
```

Expected: the live-smoke test passes, producing a non-empty `.ogg` in a tmp dir. If you don't have the key, document the gap in the commit message and proceed — the unit tests are sufficient for CI.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/media/tts.ts src/lib/media/tts.test.ts
git commit -m "$(cat <<'EOF'
feat(media): Inworld TTS v2 → mp3 → ffmpeg → ogg wrapper

Adds src/lib/media/tts.ts. ttsRender POSTs to Inworld TTS v2 with
{voiceId, modelId: inworld-tts-1.5-max, text, speed?, temperature?},
base64-decodes the audioContent into an MP3 Buffer, and pipes it
through `ffmpeg -i - -c:a libopus -b:a 64k <out.ogg>` to the requested
output path. API key from option or process.env.INWORLD_API_KEY.

Dependency seams (TtsDeps.fetch, TtsDeps.spawn) let unit tests stub
network + child process without monkey-patching globals. One live-smoke
test guarded on the env var per spec exit criterion line 543.

Mirrors OpenClaw inworld-tts/scripts/tts.sh.
EOF
)"
```

---

## Task 4: `media/image.ts` — gpt-image-2 wrapper with collision-proof filenames

Spec lines 538–545:

- Concurrency invariant §4 (lines 366–367): filename pattern `YYYYMMDD-HHMMSS-<slug>-<6char-rand>.png`. Same-second collisions during parallel image generation are impossible because the random suffix is 6 chars from `[a-z0-9]` (~36 bits ≈ 1 in 2 billion collision rate per slug-second).
- Image is written under `<vaultRoot>/images/`. The directory is created if missing.
- `gpt-image-2` returns base64; we decode and write the bytes.

We export `buildFilename` separately so the filename pattern can be unit-tested without round-tripping the network. The actual network call goes to `https://api.openai.com/v1/images/generations` with `model: 'gpt-image-2'`, `response_format: 'b64_json'`, `prompt`, `n: 1`, `size`. No new `openai` SDK dep — `fetch` is sufficient for this single endpoint.

**Files:**

- Create: `src/lib/media/image.ts`
- Test: `src/lib/media/image.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// src/lib/media/image.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { generateImage, buildFilename, type ImageDeps } from './image';

const SAMPLE_B64 = Buffer.from('fake-png-bytes').toString('base64');

function makeFakeFetch(status = 200, body: unknown = { data: [{ b64_json: SAMPLE_B64 }] }) {
  return vi.fn(async (url: string, init: RequestInit) => {
    void url;
    void init;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Bad',
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
}

async function tmpVault(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'rpg-image-'));
}

describe('buildFilename', () => {
  it('matches the YYYYMMDD-HHMMSS-<slug>-<6char-rand>.png pattern', () => {
    const fn = buildFilename('kessha');
    expect(fn).toMatch(/^\d{8}-\d{6}-kessha-[a-z0-9]{6}\.png$/);
  });

  it('produces a different suffix on each call for the same slug + same second', () => {
    const a = buildFilename('s', { now: new Date('2026-05-11T08:07:00Z') });
    const b = buildFilename('s', { now: new Date('2026-05-11T08:07:00Z') });
    // The timestamps are identical; only the random suffix varies.
    expect(a).not.toBe(b);
    expect(a.slice(0, 18)).toBe(b.slice(0, 18));
  });

  it('slugifies the input (lowercase, dashes for spaces)', () => {
    const fn = buildFilename('Kessha At The Helm');
    expect(fn).toMatch(/^\d{8}-\d{6}-kessha-at-the-helm-[a-z0-9]{6}\.png$/);
  });

  it('uses a fallback slug "scene" when input slug is empty', () => {
    const fn = buildFilename('');
    expect(fn).toMatch(/^\d{8}-\d{6}-scene-[a-z0-9]{6}\.png$/);
  });
});

describe('generateImage', () => {
  it('POSTs to the OpenAI image endpoint with the right body', async () => {
    const fetchFn = makeFakeFetch();
    const vaultRoot = await tmpVault();
    const deps: ImageDeps = { fetch: fetchFn as unknown as typeof fetch };
    await generateImage({
      prompt: 'Kessha at the helm',
      slug: 'kessha-helm',
      vaultRoot,
      apiKey: 'sk-test',
      deps,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/images/generations');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-test');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-image-2');
    expect(body.prompt).toBe('Kessha at the helm');
    expect(body.n).toBe(1);
    expect(body.response_format).toBe('b64_json');
  });

  it('writes the PNG under <vaultRoot>/images/ with the documented filename pattern', async () => {
    const fetchFn = makeFakeFetch();
    const vaultRoot = await tmpVault();
    const deps: ImageDeps = { fetch: fetchFn as unknown as typeof fetch };
    const res = await generateImage({
      prompt: 'p',
      slug: 'kessha',
      vaultRoot,
      apiKey: 'k',
      deps,
    });
    expect(res.filename).toMatch(/^\d{8}-\d{6}-kessha-[a-z0-9]{6}\.png$/);
    expect(res.path).toBe(path.join(vaultRoot, 'images', res.filename));
    expect(res.slug).toBe('kessha');
    expect(res.prompt).toBe('p');
    const stat = await fs.stat(res.path);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('creates the <vaultRoot>/images/ directory if missing', async () => {
    const fetchFn = makeFakeFetch();
    const vaultRoot = await tmpVault();
    // do NOT pre-create images/
    const deps: ImageDeps = { fetch: fetchFn as unknown as typeof fetch };
    await generateImage({ prompt: 'p', slug: 's', vaultRoot, apiKey: 'k', deps });
    const dirStat = await fs.stat(path.join(vaultRoot, 'images'));
    expect(dirStat.isDirectory()).toBe(true);
  });

  it('throws on a non-200 OpenAI response with the status code in the message', async () => {
    const fetchFn = makeFakeFetch(429, { error: { message: 'rate limited' } });
    const vaultRoot = await tmpVault();
    const deps: ImageDeps = { fetch: fetchFn as unknown as typeof fetch };
    await expect(
      generateImage({ prompt: 'p', slug: 's', vaultRoot, apiKey: 'k', deps }),
    ).rejects.toThrow(/429/);
  });

  it('throws when api key is missing (no apiKey arg + no env var)', async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const vaultRoot = await tmpVault();
    try {
      await expect(generateImage({ prompt: 'p', slug: 's', vaultRoot })).rejects.toThrow(
        /OPENAI_API_KEY/,
      );
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });

  it('throws when the response lacks b64_json', async () => {
    const fetchFn = makeFakeFetch(200, { data: [{}] });
    const vaultRoot = await tmpVault();
    const deps: ImageDeps = { fetch: fetchFn as unknown as typeof fetch };
    await expect(
      generateImage({ prompt: 'p', slug: 's', vaultRoot, apiKey: 'k', deps }),
    ).rejects.toThrow(/b64_json/);
  });
});

// Live smoke — gated on env var presence. Spec exit criterion line 544.
// Run manually with `OPENAI_API_KEY=... pnpm test src/lib/media/image.test.ts`.
describe.runIf(!!process.env.OPENAI_API_KEY)('generateImage — live smoke', () => {
  it('writes a .png under vaults/commodore-vex/images/', async () => {
    const vaultRoot = path.join(process.cwd(), 'vaults', 'commodore-vex');
    // Smoke into a tmpdir if the symlink target is read-only or absent; spec
    // line 544 names commodore-vex but we don't depend on it for correctness.
    const usable = await canWrite(path.join(vaultRoot, 'images')).catch(() => false);
    const root = usable ? vaultRoot : await tmpVault();
    const res = await generateImage({
      prompt: 'a single small ceramic cup, candlelight, simple',
      slug: 'smoke-cup',
      vaultRoot: root,
    });
    expect(res.path.endsWith('.png')).toBe(true);
    const stat = await fs.stat(res.path);
    expect(stat.size).toBeGreaterThan(0);
  }, 60_000);
});

async function canWrite(dir: string): Promise<boolean> {
  await fs.mkdir(dir, { recursive: true });
  const probe = path.join(dir, '.write-probe');
  await fs.writeFile(probe, 'x');
  await fs.unlink(probe);
  return true;
}
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm test --run src/lib/media/image.test.ts
```

Expected: FAIL with `Cannot find module './image'`.

- [ ] **Step 3: Write the minimal implementation.**

```ts
// src/lib/media/image.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { ImageMeta } from '../schemas';

const OPENAI_URL = 'https://api.openai.com/v1/images/generations';
const OPENAI_MODEL = 'gpt-image-2';
const DEFAULT_SIZE = '1024x1024';
const DEFAULT_QUALITY = 'medium';

export interface ImageDeps {
  fetch?: typeof fetch;
}

export interface GenerateImageInput {
  prompt: string;
  /** Descriptive slug used in the filename. Empty → `'scene'`. */
  slug: string;
  /** Absolute path to the vault root; PNG lands under `<vaultRoot>/images/`. */
  vaultRoot: string;
  /** OpenAI API key. Defaults to `process.env.OPENAI_API_KEY`. */
  apiKey?: string;
  /** OpenAI image size; default `'1024x1024'`. */
  size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
  /** OpenAI image quality; default `'medium'`. */
  quality?: 'low' | 'medium' | 'high' | 'auto';
  deps?: ImageDeps;
}

/**
 * Generate an image via OpenAI `gpt-image-2` and write the PNG into
 * `<vaultRoot>/images/<YYYYMMDD>-<HHMMSS>-<slug>-<6char-rand>.png`.
 * Returns the `ImageMeta` record matching `src/lib/schemas.ts`.
 *
 * Concurrency invariant §4: the 6-char random suffix prevents
 * same-second collisions across parallel image-tool calls.
 *
 * Network IO is the only side effect (besides the file write); inject
 * `deps.fetch` to stub it in tests.
 */
export async function generateImage(input: GenerateImageInput): Promise<ImageMeta> {
  const apiKey = input.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('generateImage: missing OPENAI_API_KEY (pass apiKey or set env var)');
  }
  const fetchFn = input.deps?.fetch ?? fetch;
  const size = input.size ?? DEFAULT_SIZE;
  const quality = input.quality ?? DEFAULT_QUALITY;

  const res = await fetchFn(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      prompt: input.prompt,
      n: 1,
      size,
      quality,
      response_format: 'b64_json',
    }),
  });
  if (!res.ok) {
    const detail = await safeText(res);
    throw new Error(`generateImage: OpenAI returned HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = json.data?.[0]?.b64_json;
  if (typeof b64 !== 'string' || b64.length === 0) {
    throw new Error('generateImage: OpenAI response missing data[0].b64_json');
  }

  const filename = buildFilename(input.slug);
  const dir = path.join(input.vaultRoot, 'images');
  await fs.mkdir(dir, { recursive: true });
  const outPath = path.join(dir, filename);
  await fs.writeFile(outPath, Buffer.from(b64, 'base64'));

  return {
    filename,
    path: outPath,
    prompt: input.prompt,
    slug: input.slug,
  };
}

export interface BuildFilenameOptions {
  /** Override the clock; tests pin this to assert the timestamp prefix. */
  now?: Date;
}

/**
 * Compose the filename `YYYYMMDD-HHMMSS-<slug>-<6char-rand>.png`.
 * Slug is lowercased and ASCII-slugified (spaces → dashes; anything outside
 * `[a-z0-9-]` is stripped). Empty slug → `'scene'`.
 */
export function buildFilename(slug: string, options: BuildFilenameOptions = {}): string {
  const now = options.now ?? new Date();
  const ts = formatTimestamp(now);
  const safeSlug = slugify(slug) || 'scene';
  const rand = crypto.randomBytes(4).toString('hex').slice(0, 6);
  return `${ts}-${safeSlug}-${rand}.png`;
}

function formatTimestamp(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  // Use UTC to keep filenames deterministic across machines + CI.
  const Y = d.getUTCFullYear();
  const M = pad(d.getUTCMonth() + 1);
  const D = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const m = pad(d.getUTCMinutes());
  const s = pad(d.getUTCSeconds());
  return `${Y}${M}${D}-${h}${m}${s}`;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
pnpm test --run src/lib/media/image.test.ts
```

Expected: all 11 unit tests PASS. The live-smoke `describe.runIf` is skipped unless `OPENAI_API_KEY` is set.

- [ ] **Step 5: Run the live smoke (spec exit criterion).**

If `OPENAI_API_KEY` is available, run:

```bash
OPENAI_API_KEY=$OPENAI_API_KEY pnpm test --run src/lib/media/image.test.ts
```

Expected: live-smoke passes and a `.png` lands under `vaults/commodore-vex/images/` (or a tmpdir if the symlink target isn't writable). The filename matches `YYYYMMDD-HHMMSS-<slug>-<6char>.png`. If you don't have the key, document the gap and proceed — unit tests are sufficient for CI.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/media/image.ts src/lib/media/image.test.ts
git commit -m "$(cat <<'EOF'
feat(media): gpt-image-2 wrapper with collision-proof PNG filenames

Adds src/lib/media/image.ts. generateImage POSTs to OpenAI
/v1/images/generations with {model: gpt-image-2, prompt, n: 1, size,
quality, response_format: b64_json}, base64-decodes data[0].b64_json,
writes the PNG under <vaultRoot>/images/<YYYYMMDD>-<HHMMSS>-<slug>-
<6char-rand>.png, returns ImageMeta {filename, path, prompt, slug}.

buildFilename is exported separately so the filename pattern can be
unit-tested. Concurrency invariant §4: 6-char random suffix prevents
same-second collisions during parallel image-tool fan-out.

Dependency seam (ImageDeps.fetch) lets unit tests stub the network
without monkey-patching globals. One live-smoke test guarded on
OPENAI_API_KEY per spec exit criterion line 544.

Mirrors OpenClaw rpg-image/scripts/image.py (the filename pattern adds
the 6-char suffix per concurrency invariant §4).
EOF
)"
```

---

## Task 5: Coverage gate verification + final compile/lint check

The spec's Wave 3 exit criteria are content-focused, but Wave 1 already wired an 80% coverage gate on `src/lib/vault/`. Wave 3 doesn't add files under `src/lib/vault/`, so the existing gate is unaffected, but we still want to confirm the new modules clear our usual quality bar.

**Files:**

- (No new files. Verification only.)

- [ ] **Step 1: Run the full test suite.**

```bash
pnpm test --run
```

Expected: ALL tests pass — Wave 1 + Wave 2 tests still green plus all four new Wave 3 test files. Live-smoke tests are skipped if env vars are absent (no failure).

- [ ] **Step 2: Run coverage on the new files.**

```bash
pnpm test:coverage
```

Expected: existing `src/lib/vault/**` coverage still ≥80%. Note Wave 3 files are NOT under the configured `include` (which is `src/lib/vault/**/*.ts`); that's intentional — the vault coverage gate doesn't apply to schemas/dossier/media. If you want to spot-check Wave 3 coverage manually, run:

```bash
pnpm exec vitest run --coverage \
  --coverage.include='src/lib/schemas.ts' \
  --coverage.include='src/lib/dossier.ts' \
  --coverage.include='src/lib/media/*.ts'
```

Expected: each of the four files is ≥80% on lines/functions/branches. If anything is below, add a targeted test (typically an error-path branch you haven't exercised) and re-run before moving on.

- [ ] **Step 3: Run lint to confirm no style regressions.**

```bash
pnpm lint
```

Expected: clean. If anything fires, fix in-place — we're still in TDD's "refactor" phase.

- [ ] **Step 4: Run a typecheck via the Next.js build.**

```bash
pnpm build
```

Expected: TypeScript compiles. Wave 3's new modules are pure-TS and the build picks up any cross-module type drift (e.g., a `JournalEntry` field rename in Wave 2 surfaces here).

- [ ] **Step 5: Final wave commit (no code; only if coverage required additions).**

If steps 1–4 pass with no new code, no commit is necessary — Tasks 1–4 already captured all production code. If you made small targeted-coverage additions in Step 2, commit them now:

```bash
git add src/lib/schemas.test.ts src/lib/dossier.test.ts src/lib/media/
git commit -m "$(cat <<'EOF'
test(media,dossier): bump targeted branch coverage above 80%

Adds the remaining branch-coverage tests needed to clear our usual
80% bar on the new Wave 3 modules.
EOF
)"
```

(If no coverage gaps existed, skip this step. Do not create an empty commit.)

---

## Risk & edge-case register

These are documented inline in the task preambles, but consolidated here for the reviewer:

1. **`identifyOnStage` false positives from short aliases.** A faction with alias `"the"` would match every sentence. We require alias length ≥ 3 implicitly via `\bword\b` regex (single-letter aliases still match anywhere) — if the fixture vault grows an NPC with a single-letter alias, the test in Task 2 (`'matches alias case-insensitively'`) will need a complementary "ignores too-short alias" test and `aliasHit` will need a `a.length >= 3` guard. v0 fixtures don't trigger this; flag it in a code comment.

2. **`extractVisualBlock` regex on EOF-without-newline.** Markdown files that end mid-line (no trailing `\n`) need the regex's tail to cope. The pattern `(?=^## |\Z(?![\s\S]))` matches both "next heading" and "true end of input". Verified by Task 2's "captures up to EOF" test.

3. **OpenAI `gpt-image-2` response shape may differ from `dall-e-3`.** The OpenAI Node SDK docs we consulted document `data[0].url` for DALL-E; gpt-image-2 in OpenClaw's `generate_image.py` reads `data[0].b64_json`. We send `response_format: 'b64_json'` to force that shape. If the production model name turns out to be `gpt-image-1` (the published variant as of 2026), update `OPENAI_MODEL` in `media/image.ts` — the rest of the wrapper is unchanged.

4. **Inworld TTS model id `inworld-tts-1.5-max`.** Spec line 323 says "to be verified against Inworld docs at implementation time". If the production model id has changed to e.g. `inworld-tts-2.0`, update `INWORLD_MODEL` in `media/tts.ts` — the rest of the wrapper (URL, header, body shape) is unchanged. The live-smoke test will surface a stale model id as a 4xx error.

5. **`buildFilename` UTC vs local time.** We use UTC to keep filenames deterministic across machines and CI. The fixture image filenames in `commodore-vex/images/` (e.g. `2026-04-26-18-25-11-pyre-conclave.png`) are local-time and dash-separated; our pattern is UTC and uses no dashes between date and time fields (`YYYYMMDD-HHMMSS`). This matches the spec's exact wording (line 367: `YYYYMMDD-HHMMSS-<slug>-<6char-rand>.png`); the legacy local-time filenames are leftover from OpenClaw's pre-collision-suffix era and need no migration.

6. **`fetch` in Node 22.** Global `fetch` is stable in Node 22.13+ (the project's minimum). No polyfill needed. The dependency seam (`deps.fetch`) keeps tests deterministic regardless.

7. **Test isolation when running coverage with stubbed `fetch`.** vitest's `vi.fn()` is per-test scope by default. We pass the mock in via `deps`, so there is no global mutation; concurrent test files cannot contaminate each other.

8. **`ffmpeg` spawn on Windows.** Out-of-scope per spec line 425 ("Cross-platform paths (macOS only for v0)"). The spawn call uses array-form args, which is safe on POSIX. No Windows-specific code paths.

---

## Self-review checklist (run inline; fix issues as you find them)

These were applied while writing the plan; they're listed here so a reviewer (or the agent re-reading the plan) can re-run them.

1. **Spec coverage — every row of the Wave 3 LOC table has a corresponding task:**
   - `src/lib/schemas.ts` (`FactionOutput`, `NarratorOutput`, `IllustratorOutput`, `ImageMeta`) → **Task 1**.
   - `src/lib/dossier.ts` (3 builders + `identifyOnStage` + `extractVisualBlock`) → **Task 2**.
   - `src/lib/media/tts.ts` (Inworld TTS 2 → mp3 → ffmpeg → ogg) → **Task 3**.
   - `src/lib/media/image.ts` (gpt-image-2 wrapper, filename pattern with random suffix) → **Task 4**.

2. **Spec exit criteria — every Wave 3 exit criterion in the spec (lines 540–545) maps to a task:**
   - "Dossier builders are pure functions; snapshot tests pass against fixture vault." → **Task 2** Steps 1, 3 (test asserts pure functions + reads `tests/fixtures/test-vault/style-guide.md`).
   - "`tts.ts` produces a non-empty `.ogg` for 'hello world' (live test, but design it so unit tests can stub)." → **Task 3** Step 1 (live-smoke test gated on `INWORLD_API_KEY`; unit tests cover the stubbable seams via `TtsDeps`).
   - "`media/image.ts` writes a `.png` to `vaults/commodore-vex/images/` (live test, stubbable)." → **Task 4** Step 1 (live-smoke test gated on `OPENAI_API_KEY`; unit tests cover the stubbable seam via `ImageDeps`).
   - "Filename collisions impossible: `YYYYMMDD-HHMMSS-<slug>-<6char-rand>.png`." → **Task 4** Step 1 (three `buildFilename` tests assert pattern, suffix uniqueness, slug normalization).

3. **Schemas shape verbatim with spec lines 143–172:**
   - `FactionOutput = { decision: z.string().min(1), reasoning: z.string().min(1) }` ✓.
   - `NarratorOutput = { prose: z.string().min(1), time_passed?: { days?: int>=0, hours?: int>=0 } }` ✓.
   - `IllustratorOutput = { prose_with_embeds: z.string().min(1), images: array<ImageMeta> }` ✓.
   - `ImageMeta = { filename, path, prompt, slug }` — spec defines `images: z.array(...)` with these four fields ✓.

4. **Placeholder scan.** No "TBD", "TODO", "implement later", "add appropriate error handling", or "similar to Task N". Every code block is complete and self-contained.

5. **Type consistency.**
   - `ImageMeta` is the single source of truth for the per-image record; `IllustratorOutput.images` re-uses it; `generateImage` returns it.
   - `OnStage = { npcs: EntityDoc[]; locations: EntityDoc[]; factionsToSpawn: string[] }` — same name and shape across all three dossier builders.
   - `JournalEntry` imported from `./vault/journal` (Wave 2) — not redefined.
   - `EntityDoc` imported from `./vault/entities` (Wave 1) — not redefined.
   - `WorldView`, `CharacterView`, `ThreadView` imported from `./vault/xml` (Wave 1) — not redefined.
   - `TtsDeps.fetch` and `ImageDeps.fetch` both use the same `typeof fetch` signature.
   - `ttsRender` returns `Promise<string>` (the output path); `generateImage` returns `Promise<ImageMeta>` (per the spec the per-image record is `ImageMeta`, while the per-call audio is just its path).

6. **Reference verbatim.** OpenClaw scripts consulted:
   - `inworld-tts/scripts/tts.sh` lines 80–102 — URL, modelId, request body, MP3 + ffmpeg pipeline.
   - `rpg-image/scripts/image.py` lines 45, 55–62 — `_VISUAL_RE`, random_slug, build_filename. Our `buildFilename` adds the 6-char random suffix per spec §4 (a deliberate delta from OpenClaw, which only used 4 chars without a time-stamp-collision concern).
   - `gpt-image-2/scripts/generate_image.py` lines 47–66 — `client.images.generate({ model, prompt, quality, size, n: 1 })` returning `data[0].b64_json`.

7. **Boundary contract — Wave 3 stays inside `src/lib/`:**
   - No `src/mastra/` files touched.
   - No `src/app/` files touched.
   - No imports from `mastra`, `@mastra/*`, or any provider SDK.
   - No package.json edits (Zod and `gray-matter` are already present; `openai` and `inworld` SDKs are deliberately not added — we use `fetch`).

---

## Out of scope (do NOT touch in this wave)

- Wave 4 tools/agents/registration — separate ticket; do not introduce `src/mastra/tools/`, `src/mastra/agents/`, or modify `src/mastra/index.ts`.
- Wave 5 workflow + smoke — separate ticket.
- Wave 6 API route + UI — separate ticket.
- Cleanup of `weather-agent` / `weather-workflow` — out-of-band cleanup per spec line 602.
- The live `vaults/commodore-vex/` symlink target — the image live-smoke test writes there only if writable; otherwise it falls back to a tmp dir.
- v0.5 features: alias resolution in `wikilinks.ts` (still folder-prefix-or-bust), discretionary off-stage faction spawns, per-NPC TTS voices, streaming TTS.
- The `openai` Node SDK and any Inworld TypeScript client — we deliberately use `fetch` to avoid adding deps for a single endpoint each.
