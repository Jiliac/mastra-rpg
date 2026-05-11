# Wave 3 — Schemas, Dossiers, Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure-TypeScript contracts and external-service wrappers at `src/lib/schemas.ts`, `src/lib/dossier.ts`, `src/lib/media/tts.ts`, and `src/lib/media/image.ts` so Wave 4's tools/agents and Wave 5's workflow can: validate agent I/O via Zod (`FactionOutput`, `NarratorOutput`, `IllustratorOutput`, `ImageMeta`); assemble per-agent dossiers (faction / narrator / illustrator) from already-loaded vault state plus a pure `identifyOnStage` deterministic on-stage detector and an `extractVisualBlock` style-guide reader; render Inworld TTS 2 audio (native OGG Opus, no ffmpeg) via the official `@inworld/tts` SDK; and write `gpt-image-2` PNGs via the official `openai` SDK with a collision-proof `YYYYMMDD-HHMMSS-<slug>-<6char-rand>.png` filename pattern.

**Architecture:** Four new focused files. `schemas.ts` (~50 LOC) is pure Zod with no I/O. `dossier.ts` (~200 LOC) is pure: three string builders, one deterministic detector, one regex extractor — all take pre-loaded objects (no `fs` reads). `media/tts.ts` (~60 LOC) uses the `@inworld/tts` SDK's `InworldTTS().generate({ text, voice, model: 'inworld-tts-2', encoding: 'OGG_OPUS' })` to obtain a `Uint8Array` of OGG Opus bytes directly, then writes them to the target path. No ffmpeg, no MP3 intermediate, no `spawn` — the SDK's native `OGG_OPUS` encoding eliminates the legacy mp3→ffmpeg→ogg pipeline. `media/image.ts` (~80 LOC) uses the `openai` SDK's `client.images.generate({ model: 'gpt-image-2', prompt, quality: 'high', size, n: 1 })`, decodes `result.data[0].b64_json`, and writes a PNG with a timestamp + slug + 6-char random suffix filename under `<vaultRoot>/images/`. Two new runtime deps are added in package.json: `@inworld/tts` and `openai`.

**Tech Stack:** TypeScript (ES2022, strict), Zod 4 (already present), Node 22.13+ `node:fs/promises`, `node:crypto.randomBytes` for the 6-char filename suffix, `@inworld/tts` SDK for TTS, `openai` SDK for images. Tests use vitest + `vi.fn()` to stub an injected `InworldTTS`-like object and an injected `OpenAI` client for unit-level coverage of `tts.ts` / `image.ts` (the spec calls them "live tests, stubbable" — we structure the modules so the SDK client is injectable via `TtsDeps.inworld` / `ImageDeps.openai`).

**Source spec:** `docs/superpowers/specs/2026-05-10-mastra-rpg-runtime-port-design.md` — Wave 3 section (lines 529–545), Output schemas Zod block (lines 143–172), Per-turn workflow Step 1/3/4 dossier construction (lines 177–262), `stripForTts` semantics (lines 256–258 — already implemented in Wave-1 `wikilinks.ts`, consumed by `tts.ts`), Error-matrix rows for "Image generation 5xx", "TTS API failure", "ffmpeg not on PATH" (lines 336–339; note ffmpeg is no longer required for Wave 3 — see "SDK choices" below), and Concurrency invariant §4 "Image filename includes random suffix" (lines 366–367). The OpenClaw reference scripts at `/Users/valentin/Development/ai/maz_rpg/openclaw/skills/inworld-tts/scripts/tts.sh` and `/Users/valentin/Development/ai/maz_rpg/openclaw/skills/rpg-image/scripts/image.py` are historical ground truth for the request bodies, but Wave 3 ships against the current `@inworld/tts` and `openai` SDKs with the user-confirmed model ids `inworld-tts-2` and `gpt-image-2` (which OVERRIDE the OpenClaw `inworld-tts-1.5-max` and any earlier `gpt-image-1` references). The `## Visual` regex (`_VISUAL_RE`) and the voice id (`Hank`) carry over verbatim.

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

- [ ] **Verify `ffmpeg` is on PATH (informational only for Wave 3).**

```bash
which ffmpeg
```

Expected: a non-empty path. **Wave 3 itself no longer requires `ffmpeg`** — the `@inworld/tts` SDK returns native OGG Opus bytes via `encoding: 'OGG_OPUS'`, removing the legacy mp3→ffmpeg→ogg pipeline. The spec's Error-matrix row "ffmpeg not on PATH" still applies to _later_ waves (5–6) if any other audio path is added; whether to keep the server-startup fail-fast for ffmpeg is a Wave-5 decision. For Wave 3, a missing ffmpeg is **non-blocking** — proceed without it.

- [ ] **Verify the working tree is clean on the wave-3 branch.**

```bash
git status -uno && git rev-parse --abbrev-ref HEAD
```

Expected: clean tree, branch `auto/2026-05-10-mastra-rpg-runtime-port-design-wave-3`.

---

## File structure

Production files (all new):

| File                     | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/schemas.ts`     | Four Zod schemas + their inferred TypeScript types: `FactionOutput`, `NarratorOutput`, `IllustratorOutput`, `ImageMeta`. Exact shape per spec lines 143–172. No I/O, no dependency on `src/lib/vault/`. Importable by tools, agents, workflow, and dossier builders alike.                                                                                                                                                                                                                                                  |
| `src/lib/dossier.ts`     | Pure functions assembling per-agent string inputs (XML-tag-bracketed sections) from pre-loaded vault state: `identifyOnStage(playerInput, recent, entities)`, `extractVisualBlock(styleGuide)`, `buildFactionDossier(input)`, `buildNarratorDossier(input)`, `buildIllustratorDossier(input)`. No `fs` reads; caller (the workflow in Wave 5) does all loading. Mirrors OpenClaw `rpg-narrator/buildDossier.py`.                                                                                                            |
| `src/lib/media/tts.ts`   | `ttsRender(text, options) → Promise<string>` that calls `InworldTTS().generate({ text, voice, model: 'inworld-tts-2', encoding: 'OGG_OPUS' })` from the `@inworld/tts` SDK, writes the returned `Uint8Array` of OGG Opus bytes to `options.output`, and returns the resolved absolute path. Injectable seam: `TtsDeps.inworld` (a fake `InworldTTS`-shaped object) — no ffmpeg, no `spawn`, no raw `fetch`.                                                                                                                 |
| `src/lib/media/image.ts` | `generateImage({ prompt, slug, vaultRoot }) → Promise<ImageMeta>` that calls `client.images.generate({ model: 'gpt-image-2', prompt, quality: 'high', size, n: 1 })` from the `openai` SDK, base64-decodes `result.data[0].b64_json`, writes the PNG under `<vaultRoot>/images/<YYYYMMDD>-<HHMMSS>-<slug>-<6char-rand>.png`, and returns `{ filename, path, prompt, slug }` (matches `ImageMeta` schema). Injectable seam: `ImageDeps.openai`. `buildFilename` is also exported for unit-level filename-pattern assertions. |

Test files (co-located):

| File                          | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/schemas.test.ts`     | Each schema accepts valid shapes and rejects the documented invalid shapes (empty `prose`, missing `decision`, etc.). `ImageMeta` validates the workflow contract end-to-end.                                                                                                                                                                                                                                  |
| `src/lib/dossier.test.ts`     | `extractVisualBlock` returns the right slice for the fixture style-guide (and `null` if missing). `identifyOnStage` is deterministic against a hand-built recent-journal + player-input + entities map (kessha on stage → `factionsToSpawn` includes `red-banner`, dedup correct). All three `build*Dossier` functions produce snapshot-stable text.                                                           |
| `src/lib/media/tts.test.ts`   | `ttsRender` invokes the injected `InworldTTS`-like fake with the right `{ text, voice, model: 'inworld-tts-2', encoding: 'OGG_OPUS' }`, writes the returned bytes to the target path, and surfaces SDK errors as thrown errors. One live-test gate (`describe.runIf`) guarded by `INWORLD_API_KEY` for the spec's "hello world" smoke.                                                                         |
| `src/lib/media/image.test.ts` | `buildFilename` matches the regex `^\d{8}-\d{6}-[a-z0-9-]+-[a-z0-9]{6}\.png$`; same slug twice produces different filenames; `generateImage` invokes the injected `OpenAI` client's `images.generate` with `{ model: 'gpt-image-2', quality: 'high', n: 1, … }`, writes the b64-decoded bytes to disk, returns the right `ImageMeta`. One live-test gate guarded by `OPENAI_API_KEY` for the spec's PNG smoke. |

No new fixtures. The dossier tests synthesize their inputs inline (so test reviewers can see exactly what an `AlwaysLoaded`-shaped object looks like at the call site without chasing fixture files).

---

## SDK choices

Wave 3 introduces two external-service wrappers; this section documents which client each wrapper uses, and which SDK the _later_ waves will use for the LLM calls Wave 3 deliberately does not make:

- **Images (Wave 3):** the official `openai` Node SDK. We call `client.images.generate({ model: 'gpt-image-2', prompt, quality: 'high', size, n: 1 })` and decode `result.data[0].b64_json`. The Vercel AI SDK does not currently expose image generation, so we use the OpenAI SDK directly. The `OpenAI` client constructor is injectable via `ImageDeps.openai` for tests.
- **TTS (Wave 3):** the official `@inworld/tts` Node SDK. We call `InworldTTS().generate({ text, voice, model: 'inworld-tts-2', encoding: 'OGG_OPUS' })` and write the returned `Uint8Array` directly to disk. Because the SDK supports `OGG_OPUS` natively, the legacy mp3 → ffmpeg → ogg pipeline is **dropped** — `media/tts.ts` no longer shells `ffmpeg`. The `InworldTTS` constructor is injectable via `TtsDeps.inworld` for tests.
- **LLM calls (waves 4–5, not this wave):** the Vercel AI SDK. The faction / narrator / illustrator agents will call `generateObject` with the Zod schemas defined in this wave's `src/lib/schemas.ts`. Wave 3 produces those schemas (plus dossiers + media wrappers); it does NOT call the LLM, so the Vercel AI SDK choice does not affect Wave 3 code — but is noted here so the contracts in `schemas.ts` are designed with `generateObject` consumption in mind.

Model ids are fixed by user fiat for this wave: image model is `gpt-image-2` (NOT `gpt-image-1`), TTS model is `inworld-tts-2` (NOT `inworld-tts-1.5-max`), default image quality is `'high'`. These overrides supersede any conflicting reference in the spec, OpenClaw scripts, or prior plan revisions.

---

## Implementation order (TDD discipline)

Each task follows red-green-refactor explicitly: Step "Write the failing test" → "Run to verify it fails" → "Write minimal implementation" → "Run to verify it passes" → "Commit". Do not batch implementation ahead of tests.

Order (contracts first, then pure builders, then media wrappers; mirrors the spec's listed order in Wave 3 table):

1. **Task 1: `schemas.ts`** — leaf-most contract; everything else imports `ImageMeta`. Zod-only; no `fs`, no Mastra.
2. **Task 2: `dossier.ts`** — pure builders + on-stage detector + visual-block extractor. Imports `schemas.ts` only for one type (`ImageMeta` isn't needed; the dossier is text). Wave-1 types are imported but no `fs` calls are made.
3. **Task 3: `media/tts.ts`** — first wrapper to land; smaller surface than image. Establishes the "inject the SDK client" pattern (`TtsDeps.inworld`) that image.ts re-uses with `ImageDeps.openai`.
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

  it('returns the same string for the same inputs (value-equality of deterministic output)', () => {
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
 * is absent. Mirrors OpenClaw `image.py:_VISUAL_RE` (Python's `\Z` end-of-
 * string anchor is not a valid JS regex token — we anchor the trailing
 * alternative with `$(?![\s\S])`, a negative-lookahead that pins `$` to
 * true end-of-input. The leading `^## Visual` still uses `m`-mode so the
 * heading is matched on its own line; `$` alone with the `m` flag would
 * incorrectly match at every line break, truncating multi-line blocks).
 *
 * Verified in Node against the three reviewer-cited test cases:
 *   "## Visual\nFirst block.\nSecond line.\n## Other\nignored"
 *     -> "First block.\nSecond line."
 *   "## Visual\nOnly block.\nMultiple lines."
 *     -> "Only block.\nMultiple lines."
 *   "## Visual\nFixture single sentence."
 *     -> "Fixture single sentence."
 */
const VISUAL_RE = /^## Visual\s*\n([\s\S]*?)(?=\n## |$(?![\s\S]))/m;

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
  // Caller (the workflow in Wave 5) MUST pass `entities[]` with unique slugs
  // per (kind, slug) pair — typically just the AlwaysLoaded set deduped at
  // load time. We do NOT carry a `seen` Set here because doing so would mask
  // upstream bugs where the same NPC is loaded twice; the workflow's vault
  // loader is the right place to enforce uniqueness.
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
    // NOTE: we intentionally do NOT esc() the markdown body. Bodies routinely
    // contain wikilinks `[[…]]` (XML-safe) and the LLM reads them as markdown;
    // running them through esc() would mangle stray `<` / `>` from prose into
    // `&lt;` / `&gt;` and degrade narration quality. Attribute values
    // (slug, faction) ARE escaped because they sit inside double quotes.
    lines.push(`  <npc slug="${esc(n.slug)}"${f}>${n.body.trim()}</npc>`);
  }
  for (const l of on.locations) {
    // Same reasoning as above: body stays raw markdown; the slug attribute is escaped.
    lines.push(`  <location slug="${esc(l.slug)}">${l.body.trim()}</location>`);
  }
  return lines.join('\n');
}

function renderJournal(recent: JournalEntry[]): string {
  // Same reasoning as renderOnStage: journal bodies are markdown that the LLM
  // reads directly — leave raw. Only the `heading` attribute (inside quotes)
  // is escaped.
  return recent
    .map((e) => `  <entry heading="${esc(e.heading)}">${e.body.trim()}</entry>`)
    .join('\n');
}

function renderDecisions(decisions: { slug: string; decision: string }[]): string {
  if (decisions.length === 0) return '';
  // Decision text is short narrator-facing prose — leave raw; only the slug
  // attribute (inside quotes) is escaped.
  return (
    '\n' +
    decisions
      .map((d) => `  <decision faction="${esc(d.slug)}">${d.decision.trim()}</decision>`)
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

Expected: all 17 tests PASS. The canonical `VISUAL_RE` (`/^## Visual\s*\n([\s\S]*?)(?=\n## |$(?![\s\S]))/m`) already handles both the next-heading and the EOF cases — no regex retries should be needed. The `(?![\s\S])` negative-lookahead pins `$` to true end-of-input so it does not match at the first `\n` (which is what `$` does on its own in `m`-mode). If `identifyOnStage` returns extra entries due to over-eager alias matching (e.g. "the" matches everywhere), this is intentional: see Risk-register entry #1 — the v0 fixture vault has no aliases short enough to trigger this and we ship without the `a.length >= 3` guard (the negative test is also deliberately omitted; see the risk register).

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

## Task 3: `media/tts.ts` — `@inworld/tts` SDK with native OGG Opus

Spec lines 537–543 require a non-empty `.ogg` for "hello world" and design the module so unit tests can stub. We ship against the official `@inworld/tts` Node SDK (model id `inworld-tts-2`), which exposes `InworldTTS().generate({ text, voice, model, encoding: 'OGG_OPUS' })` returning a `Uint8Array` of native OGG Opus bytes — no MP3 intermediate, no ffmpeg shell-out, no spawn. The wrapper is a thin shim: read API key, call the SDK, write the returned bytes to disk, return the absolute path.

The design pattern for stubbability is "inject the SDK client as an options field, default to a real `InworldTTS()`". The module exports a single function `ttsRender(text, options)` plus the `TtsDeps` interface for tests to pass in a fake `InworldTTS`-shaped object (anything with a `generate(args) → Promise<Uint8Array>` method). Because the SDK returns OGG bytes directly, the spec's Error-matrix row "ffmpeg not on PATH" (line 339) is no longer relevant to this module — the ffmpeg pre-flight check is informational only for Wave 3 (see pre-flight section above).

**Files:**

- Create: `src/lib/media/tts.ts`
- Test: `src/lib/media/tts.test.ts`

- [ ] **Step 0: Add the `@inworld/tts` dependency and verify the SDK surface via ctx7.**

```bash
# Add the dependency (uses pnpm per project convention).
pnpm add @inworld/tts

# Verify the current SDK surface — the model id `inworld-tts-2` and the
# `OGG_OPUS` encoding are fixed by user fiat for this wave (do NOT
# re-litigate the model name via ctx7), but the exact argument shape of
# `InworldTTS().generate({ ... })` should be confirmed against current docs.
npx ctx7@latest library "Inworld TTS"
# Pick the @inworld/tts library id from the output.
npx ctx7@latest docs <libraryId> "InworldTTS generate method arguments: text, voice, model, encoding, outputFile, return type"
```

The user-fixed parameters are:

- **Model id:** `inworld-tts-2` (NOT `inworld-tts-1.5-max`; the spec was written before TTS-2 existed). Do not change this via ctx7 output.
- **Encoding:** `'OGG_OPUS'` (native — eliminates mp3→ffmpeg→ogg).
- **Voice id:** `'Hank'` (carried over from OpenClaw; verify it is still a valid TTS-2 voice via ctx7 if the live smoke 4xx's).
- **Auth:** the SDK reads `INWORLD_API_KEY` from the environment; an `{ apiKey }` constructor arg is also accepted.

If ctx7 reports a renamed argument key (e.g. `voice` → `voiceName`) or a different return shape (e.g. `{ audio: Uint8Array }` instead of `Uint8Array`), update Step 1 and Step 3 accordingly before continuing. The live-smoke test (Step 5) will surface any remaining mismatch as an SDK exception.

- [ ] **Step 1: Write the failing test.**

```ts
// src/lib/media/tts.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ttsRender, type TtsDeps, type InworldTtsLike } from './tts';

const SAMPLE_BYTES = new Uint8Array(Buffer.from('fake-ogg-bytes'));

/**
 * Fake InworldTTS-shaped object. `ttsRender` only ever calls
 * `client.generate(args)` and expects a `Uint8Array` back, so we don't have
 * to mirror the entire SDK surface — only the `generate` method.
 */
function makeFakeInworld(bytes: Uint8Array | Error = SAMPLE_BYTES): InworldTtsLike & {
  generate: ReturnType<typeof vi.fn>;
} {
  const generate = vi.fn(async (_args: Record<string, unknown>) => {
    if (bytes instanceof Error) throw bytes;
    return bytes;
  });
  return { generate };
}

async function tmpOgg(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-tts-'));
  return path.join(dir, 'out.ogg');
}

describe('ttsRender', () => {
  it('calls InworldTTS.generate with the right text, voice, model, and encoding', async () => {
    const inworld = makeFakeInworld();
    const out = await tmpOgg();
    const deps: TtsDeps = { inworld };

    await ttsRender('hello world', {
      voice: 'Hank',
      output: out,
      apiKey: 'secret',
      deps,
    });

    expect(inworld.generate).toHaveBeenCalledTimes(1);
    const args = inworld.generate.mock.calls[0][0] as Record<string, unknown>;
    expect(args.text).toBe('hello world');
    expect(args.voice).toBe('Hank');
    expect(args.model).toBe('inworld-tts-2');
    expect(args.encoding).toBe('OGG_OPUS');
  });

  it('writes the returned OGG bytes to options.output and returns the absolute path', async () => {
    const inworld = makeFakeInworld();
    const out = await tmpOgg();
    const deps: TtsDeps = { inworld };

    const returned = await ttsRender('hello world', {
      voice: 'Hank',
      output: out,
      apiKey: 'k',
      deps,
    });
    expect(returned).toBe(out);
    const written = await fs.readFile(out);
    expect(written.equals(Buffer.from(SAMPLE_BYTES))).toBe(true);
  });

  it('throws when the SDK errors (e.g. 5xx surfaced as an SDK exception)', async () => {
    const inworld = makeFakeInworld(new Error('Inworld 500: server boom'));
    const out = await tmpOgg();
    const deps: TtsDeps = { inworld };

    await expect(
      ttsRender('hello', { voice: 'Hank', output: out, apiKey: 'k', deps }),
    ).rejects.toThrow(/server boom/);
  });

  it('creates the output directory if missing', async () => {
    const inworld = makeFakeInworld();
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-tts-mkdir-'));
    const out = path.join(baseDir, 'nested', 'dir', 'out.ogg');
    const deps: TtsDeps = { inworld };

    await ttsRender('hello', { voice: 'Hank', output: out, apiKey: 'k', deps });
    const stat = await fs.stat(out);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('throws when API key is missing (no apiKey arg + no env var + no injected client)', async () => {
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
  it('produces a non-empty .ogg for "hello world" via @inworld/tts SDK', async () => {
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
import { InworldTTS } from '@inworld/tts';

const INWORLD_MODEL = 'inworld-tts-2';
const DEFAULT_ENCODING = 'OGG_OPUS' as const;

/**
 * Minimal structural type for the `@inworld/tts` client — `ttsRender` only
 * calls `.generate(args)`. Tests inject a fake of this shape via
 * `TtsDeps.inworld` without having to construct a real SDK instance.
 */
export interface InworldTtsLike {
  generate(args: {
    text: string;
    voice: string;
    model: string;
    encoding: 'OGG_OPUS' | 'MP3' | 'LINEAR16';
    outputFile?: string;
    speakingRate?: number;
    temperature?: number;
  }): Promise<Uint8Array>;
}

/**
 * Dependency seams. The only IO boundary in this module is the Inworld SDK
 * client; tests pass in a fake `InworldTtsLike` to avoid network calls and
 * env-var setup.
 */
export interface TtsDeps {
  inworld?: InworldTtsLike;
}

export interface TtsOptions {
  /** Inworld voice id. Default: `'Hank'`. */
  voice?: string;
  /** Absolute path the final `.ogg` should be written to. Required. */
  output: string;
  /** Inworld API key. Defaults to `process.env.INWORLD_API_KEY`. */
  apiKey?: string;
  /** Per-request speaking-rate multiplier; passed through to the SDK if set. */
  speakingRate?: number;
  /** Per-request temperature; passed through to the SDK if set. */
  temperature?: number;
  deps?: TtsDeps;
}

/**
 * Render `text` to an OGG Opus file at `options.output` via the
 * `@inworld/tts` SDK (model `inworld-tts-2`, encoding `OGG_OPUS`).
 *
 * The SDK returns OGG bytes natively — no MP3 intermediate, no ffmpeg.
 * Throws on missing API key, on SDK errors (network, auth, quota), or on
 * filesystem failures.
 */
export async function ttsRender(text: string, options: TtsOptions): Promise<string> {
  // Default-injecting the real client requires the env var (or an
  // explicit apiKey). If the caller provides `deps.inworld`, they own
  // auth — we never read INWORLD_API_KEY in that case.
  const inworld = options.deps?.inworld ?? defaultClient(options.apiKey);
  const voice = options.voice ?? 'Hank';

  await fs.mkdir(path.dirname(options.output), { recursive: true });

  const args: Parameters<InworldTtsLike['generate']>[0] = {
    text,
    voice,
    model: INWORLD_MODEL,
    encoding: DEFAULT_ENCODING,
  };
  if (typeof options.speakingRate === 'number') args.speakingRate = options.speakingRate;
  if (typeof options.temperature === 'number') args.temperature = options.temperature;

  const bytes = await inworld.generate(args);
  await fs.writeFile(options.output, Buffer.from(bytes));
  return options.output;
}

function defaultClient(apiKey?: string): InworldTtsLike {
  const key = apiKey ?? process.env.INWORLD_API_KEY;
  if (!key) {
    throw new Error('ttsRender: missing INWORLD_API_KEY (pass apiKey or set env var)');
  }
  // The SDK accepts `{ apiKey }` or reads INWORLD_API_KEY from env on its own.
  // Casting through `unknown` because the SDK's TS surface and our minimal
  // `InworldTtsLike` may differ on optional fields (`outputFile`, `kill`, …).
  return InworldTTS({ apiKey: key }) as unknown as InworldTtsLike;
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
git add package.json pnpm-lock.yaml src/lib/media/tts.ts src/lib/media/tts.test.ts
git commit -m "$(cat <<'EOF'
feat(media): @inworld/tts SDK wrapper with native OGG Opus output

Adds src/lib/media/tts.ts. ttsRender calls InworldTTS().generate({
text, voice, model: 'inworld-tts-2', encoding: 'OGG_OPUS' }) from the
official @inworld/tts SDK and writes the returned Uint8Array to the
requested output path. API key from option or process.env.INWORLD_API_KEY
(or pre-configured on an injected client).

The SDK returns native OGG bytes — no MP3 intermediate, no ffmpeg
shell-out, no spawn. Dependency seam (TtsDeps.inworld) lets unit tests
inject a fake InworldTtsLike. One live-smoke test guarded on
INWORLD_API_KEY per spec exit criterion line 543.

Adds @inworld/tts to dependencies.
EOF
)"
```

---

## Task 4: `media/image.ts` — `openai` SDK wrapper for `gpt-image-2` with collision-proof filenames

Spec lines 538–545:

- Concurrency invariant §4 (lines 366–367): filename pattern `YYYYMMDD-HHMMSS-<slug>-<6char-rand>.png`. The 6 hex chars are sourced from `crypto.randomBytes(3).toString('hex')` (3 bytes = exactly 6 hex chars = **24 bits** of entropy ≈ 1 in 16.7 million collision rate per slug-second — comfortably below the parallel-illustrator fan-out cardinality of a handful of images per turn).
- Image is written under `<vaultRoot>/images/`. The directory is created if missing.
- `gpt-image-2` returns base64 in `result.data[0].b64_json`; we decode and write the bytes.

We export `buildFilename` separately so the filename pattern can be unit-tested without round-tripping the network. The actual API call goes through the official `openai` Node SDK: `client.images.generate({ model: 'gpt-image-2', prompt, quality: 'high', size, n: 1 })`. The `OpenAI` client constructor is injectable via `ImageDeps.openai` so unit tests can pass in a fake without monkey-patching the SDK.

**Files:**

- Create: `src/lib/media/image.ts`
- Test: `src/lib/media/image.test.ts`

- [ ] **Step 0: Add the `openai` dependency and verify the SDK surface via ctx7.**

```bash
# Add the dependency (uses pnpm per project convention).
pnpm add openai

# Verify the current SDK surface for client.images.generate. The model id
# `gpt-image-2` and the default quality `'high'` are FIXED by user fiat for
# this wave — do NOT use ctx7 to re-litigate the model name (prior reviewer
# rounds insisted on `gpt-image-1`; the human owner has corrected this and
# `gpt-image-2` is the target). Use ctx7 only to confirm the argument keys
# and the response field name.
npx ctx7@latest library "OpenAI Node"
# Pick the openai library id from the output (e.g. `/openai/openai-node`).
npx ctx7@latest docs <libraryId> "client.images.generate arguments: model, prompt, n, size, quality, and response field b64_json"
```

The user-fixed parameters are:

- **Model id:** `gpt-image-2` (NOT `gpt-image-1`). Do not change.
- **Quality default:** `'high'` (NOT `'medium'`).
- **Size default:** `'1024x1024'`.
- **Auth:** the SDK reads `OPENAI_API_KEY` from the environment by default; an `{ apiKey }` constructor argument is also accepted.

If ctx7 reports a renamed argument (e.g. `quality` → `quality_tier`) or a different result-field name (e.g. `b64_json` → `image_b64`), update Step 1 and Step 3 accordingly before continuing. The live-smoke test (Step 5) will surface any remaining mismatch as an SDK exception.

- [ ] **Step 1: Write the failing test.**

```ts
// src/lib/media/image.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { generateImage, buildFilename, type ImageDeps, type OpenAILike } from './image';

const SAMPLE_B64 = Buffer.from('fake-png-bytes').toString('base64');

/**
 * Fake OpenAI-shaped client. `generateImage` only ever calls
 * `client.images.generate(args)` and expects `{ data: [{ b64_json }] }` back,
 * so we don't have to mirror the full SDK surface — only `images.generate`.
 */
function makeFakeOpenAI(
  body: { data?: Array<{ b64_json?: string }> } | Error = {
    data: [{ b64_json: SAMPLE_B64 }],
  },
): OpenAILike & { images: { generate: ReturnType<typeof vi.fn> } } {
  const generate = vi.fn(async (_args: Record<string, unknown>) => {
    if (body instanceof Error) throw body;
    return body;
  });
  return { images: { generate } };
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
  it('calls client.images.generate with model=gpt-image-2 + quality=high + n=1', async () => {
    const openai = makeFakeOpenAI();
    const vaultRoot = await tmpVault();
    const deps: ImageDeps = { openai };
    await generateImage({
      prompt: 'Kessha at the helm',
      slug: 'kessha-helm',
      vaultRoot,
      apiKey: 'sk-test',
      deps,
    });
    expect(openai.images.generate).toHaveBeenCalledTimes(1);
    const args = openai.images.generate.mock.calls[0][0] as Record<string, unknown>;
    expect(args.model).toBe('gpt-image-2');
    expect(args.prompt).toBe('Kessha at the helm');
    expect(args.n).toBe(1);
    expect(args.quality).toBe('high');
    expect(args.size).toBe('1024x1024');
  });

  it('writes the PNG under <vaultRoot>/images/ with the documented filename pattern', async () => {
    const openai = makeFakeOpenAI();
    const vaultRoot = await tmpVault();
    const deps: ImageDeps = { openai };
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
    const openai = makeFakeOpenAI();
    const vaultRoot = await tmpVault();
    // do NOT pre-create images/
    const deps: ImageDeps = { openai };
    await generateImage({ prompt: 'p', slug: 's', vaultRoot, apiKey: 'k', deps });
    const dirStat = await fs.stat(path.join(vaultRoot, 'images'));
    expect(dirStat.isDirectory()).toBe(true);
  });

  it('surfaces SDK errors (e.g. 429 rate-limit) as a thrown error', async () => {
    const openai = makeFakeOpenAI(new Error('429 rate limited'));
    const vaultRoot = await tmpVault();
    const deps: ImageDeps = { openai };
    await expect(
      generateImage({ prompt: 'p', slug: 's', vaultRoot, apiKey: 'k', deps }),
    ).rejects.toThrow(/429/);
  });

  it('throws when api key is missing (no apiKey arg + no env var + no injected client)', async () => {
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

  it('throws when the SDK response lacks b64_json', async () => {
    const openai = makeFakeOpenAI({ data: [{}] });
    const vaultRoot = await tmpVault();
    const deps: ImageDeps = { openai };
    await expect(
      generateImage({ prompt: 'p', slug: 's', vaultRoot, apiKey: 'k', deps }),
    ).rejects.toThrow(/b64_json/);
  });

  it('honors a caller-provided quality override (still defaults to high otherwise)', async () => {
    const openai = makeFakeOpenAI();
    const vaultRoot = await tmpVault();
    const deps: ImageDeps = { openai };
    await generateImage({
      prompt: 'p',
      slug: 's',
      vaultRoot,
      apiKey: 'k',
      quality: 'low',
      deps,
    });
    const args = openai.images.generate.mock.calls[0][0] as Record<string, unknown>;
    expect(args.quality).toBe('low');
  });
});

// Live smoke — gated on env var presence. Spec exit criterion line 544.
// Run manually with `OPENAI_API_KEY=... pnpm test src/lib/media/image.test.ts`.
describe.runIf(!!process.env.OPENAI_API_KEY)('generateImage — live smoke', () => {
  it('writes a .png under vaults/commodore-vex/images/ via gpt-image-2', async () => {
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
import OpenAI from 'openai';
import type { ImageMeta } from '../schemas';

const OPENAI_MODEL = 'gpt-image-2';
const DEFAULT_SIZE = '1024x1024';
const DEFAULT_QUALITY = 'high';

/**
 * Minimal structural type for the `openai` client. `generateImage` only
 * calls `client.images.generate(args)`. Tests inject a fake of this shape
 * via `ImageDeps.openai` without instantiating the real SDK.
 */
export interface OpenAILike {
  images: {
    generate(args: {
      model: string;
      prompt: string;
      n: number;
      size: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
      quality: 'low' | 'medium' | 'high' | 'auto';
    }): Promise<{ data?: Array<{ b64_json?: string }> }>;
  };
}

export interface ImageDeps {
  openai?: OpenAILike;
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
  /** OpenAI image quality; default `'high'`. */
  quality?: 'low' | 'medium' | 'high' | 'auto';
  deps?: ImageDeps;
}

/**
 * Generate an image via OpenAI `gpt-image-2` (default quality `'high'`) and
 * write the PNG into
 * `<vaultRoot>/images/<YYYYMMDD>-<HHMMSS>-<slug>-<6char-rand>.png`.
 * Returns the `ImageMeta` record matching `src/lib/schemas.ts`.
 *
 * Concurrency invariant §4: the 6-char random suffix prevents same-second
 * collisions across parallel image-tool calls.
 *
 * The SDK client is the only IO seam; inject `deps.openai` to stub it in
 * tests. Auth is handled by the SDK — pass `apiKey` or set
 * `OPENAI_API_KEY`; the SDK retries/backs-off internally on 5xx.
 */
export async function generateImage(input: GenerateImageInput): Promise<ImageMeta> {
  const openai = input.deps?.openai ?? defaultClient(input.apiKey);
  const size = input.size ?? DEFAULT_SIZE;
  const quality = input.quality ?? DEFAULT_QUALITY;

  const result = await openai.images.generate({
    model: OPENAI_MODEL,
    prompt: input.prompt,
    n: 1,
    size,
    quality,
  });

  const b64 = result.data?.[0]?.b64_json;
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

function defaultClient(apiKey?: string): OpenAILike {
  const key = apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error('generateImage: missing OPENAI_API_KEY (pass apiKey or set env var)');
  }
  // Cast through `unknown` because the SDK's actual `images.generate` return
  // type carries more fields than our minimal `OpenAILike`.
  return new OpenAI({ apiKey: key }) as unknown as OpenAILike;
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
  // 3 bytes = exactly 6 hex chars = 24 bits of entropy
  // (~1 in 16.7 million collisions per slug-second).
  const rand = crypto.randomBytes(3).toString('hex');
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
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
pnpm test --run src/lib/media/image.test.ts
```

Expected: all 11 unit tests PASS (4 `buildFilename` tests + 7 `generateImage` tests). The live-smoke `describe.runIf` is skipped unless `OPENAI_API_KEY` is set.

- [ ] **Step 5: Run the live smoke (spec exit criterion).**

If `OPENAI_API_KEY` is available, run:

```bash
OPENAI_API_KEY=$OPENAI_API_KEY pnpm test --run src/lib/media/image.test.ts
```

Expected: live-smoke passes and a `.png` lands under `vaults/commodore-vex/images/` (or a tmpdir if the symlink target isn't writable). The filename matches `YYYYMMDD-HHMMSS-<slug>-<6char>.png`. If you don't have the key, document the gap and proceed — unit tests are sufficient for CI.

- [ ] **Step 6: Commit.**

```bash
git add package.json pnpm-lock.yaml src/lib/media/image.ts src/lib/media/image.test.ts
git commit -m "$(cat <<'EOF'
feat(media): openai SDK wrapper for gpt-image-2 with quality=high

Adds src/lib/media/image.ts. generateImage calls
client.images.generate({ model: 'gpt-image-2', prompt, n: 1, size,
quality: 'high' }) from the official openai Node SDK,
base64-decodes data[0].b64_json, writes the PNG under
<vaultRoot>/images/<YYYYMMDD>-<HHMMSS>-<slug>-<6char-rand>.png,
returns ImageMeta {filename, path, prompt, slug}.

Model id (`gpt-image-2`) and default quality (`'high'`) are fixed by
user fiat for this wave — overrides any earlier `gpt-image-1` /
`'medium'` references in spec or OpenClaw scripts. buildFilename is
exported separately so the filename pattern can be unit-tested.
Concurrency invariant §4: 6-char random suffix prevents same-second
collisions during parallel image-tool fan-out.

Dependency seam (ImageDeps.openai) lets unit tests inject a fake
OpenAILike. One live-smoke test guarded on OPENAI_API_KEY per spec
exit criterion line 544. Adds `openai` to dependencies.
EOF
)"
```

---

## Task 5: Coverage gate verification + final compile/lint check

The spec's Wave 3 exit criteria are content-focused. Wave 1 wired an 80% coverage gate scoped to `src/lib/vault/**/*.ts` — silently excluding Wave 3's new files would be a coverage-hygiene regression, so this task **extends `vitest.config.ts`'s `coverage.include`** to cover the Wave 3 surface (`src/lib/schemas.ts`, `src/lib/dossier.ts`, `src/lib/media/**/*.ts`) and enforces the same 80% gate on the new files.

**Files:**

- Edit: `vitest.config.ts` (one-line `coverage.include` extension).

- [ ] **Step 1: Extend the coverage `include` glob to cover Wave 3 files.**

Edit `vitest.config.ts` so the `coverage.include` array reads:

```ts
include: [
  'src/lib/vault/**/*.ts',
  'src/lib/schemas.ts',
  'src/lib/dossier.ts',
  'src/lib/media/**/*.ts',
],
```

Exclude the colocated `*.test.ts` files (the v8 reporter already does this by default for files matching `vitest`'s `include` test pattern, but if necessary add `exclude: ['**/*.test.ts']` for belt-and-suspenders). Keep the 80/80/80/80 thresholds unchanged — they now apply to the Wave 3 surface too.

- [ ] **Step 2: Run the full test suite.**

```bash
pnpm test --run
```

Expected: ALL tests pass — Wave 1 + Wave 2 tests still green plus all four new Wave 3 test files. Live-smoke tests are skipped if env vars are absent (no failure).

- [ ] **Step 3: Run coverage with the extended include glob.**

```bash
pnpm test:coverage
```

Expected: combined coverage of `src/lib/vault/**/*.ts` + `src/lib/schemas.ts` + `src/lib/dossier.ts` + `src/lib/media/**/*.ts` is ≥80% on lines / functions / branches / statements. If any of the four new files is below threshold, add a targeted test (typically an error-path branch — e.g. the `Inworld response missing audioContent` path, the `data[0].b64_json` missing path, or `extractVisualBlock` returning null) and re-run before moving on. Do **not** disable the gate or scope the include glob back down to vault-only as a workaround — the whole point of this revision is to keep coverage hygiene on the new surface.

- [ ] **Step 4: Run lint to confirm no style regressions.**

```bash
pnpm lint
```

Expected: clean. If anything fires, fix in-place — we're still in TDD's "refactor" phase.

- [ ] **Step 5: Run a typecheck via the Next.js build.**

```bash
pnpm build
```

Expected: TypeScript compiles. Wave 3's new modules are pure-TS and the build picks up any cross-module type drift (e.g., a `JournalEntry` field rename in Wave 2 surfaces here).

- [ ] **Step 6: Final wave commit (`vitest.config.ts` change + any targeted-coverage test additions).**

The `vitest.config.ts` edit in Step 1 always needs a commit. If Step 3 surfaced coverage gaps and you added test cases to close them, fold those into the same commit:

```bash
git add vitest.config.ts src/lib/schemas.test.ts src/lib/dossier.test.ts src/lib/media/
git commit -m "$(cat <<'EOF'
chore(test): extend coverage gate to Wave 3 surface

Adds src/lib/schemas.ts, src/lib/dossier.ts, and src/lib/media/**/*.ts
to vitest.config.ts coverage.include so the 80/80/80/80 threshold now
applies to the new Wave 3 modules, not just src/lib/vault/**.

(Optionally bundles a handful of targeted branch-coverage tests added
to clear the gate.)
EOF
)"
```

If the vitest.config.ts change was the only edit and no test additions were needed, drop the test paths from the `git add` line. Do not create an empty commit.

---

## Risk & edge-case register

These are documented inline in the task preambles, but consolidated here for the reviewer:

1. **`identifyOnStage` false positives from short aliases.** A faction with alias `"the"` would match every sentence. v0 fixtures have no aliases shorter than 3 characters, so we ship **without** an `a.length >= 3` guard — and correspondingly **without** a "ignores a short-alias" negative test. This is a deliberate choice in this revision: keeping the guard out of v0 keeps the plan honest about what is and isn't tested. If a future fixture / vault grows a single-letter alias, add the guard AND the matching negative test together (don't ship one without the other).

2. **`extractVisualBlock` regex on EOF-without-newline.** Markdown files that end mid-line (no trailing `\n`) need the regex's tail to cope. We use `(?=\n## |$(?![\s\S]))` with the `m` flag — the negative-lookahead `(?![\s\S])` after `$` pins the anchor to true end-of-input (no characters of any kind may follow), which is the JavaScript equivalent of Python's `\Z` (which is NOT a valid JS regex token — an earlier draft used it and would have thrown `SyntaxError: Invalid escape` at module load). The `(?![\s\S])` clamp is load-bearing: a plain `$` under the `m` flag would also match at every internal line break, causing the lazy `[\s\S]*?` to stop at the first `\n` and truncate multi-line blocks. The leading `^## Visual` anchor still benefits from `m`-mode (so the heading is matched on its own line). Verified in Node against the reviewer-cited tests: "First block.\nSecond line.", "Only block.\nMultiple lines.", and "Fixture single sentence." all return their full bodies under the corrected regex (also verified by Task 2's "captures up to EOF" and "captures up to the next ## heading" tests).

3. **OpenAI `gpt-image-2` model id (FIXED by user fiat).** The user has corrected three prior reviewer rounds that insisted on `gpt-image-1`; the canonical target for this wave is `gpt-image-2` with default quality `'high'`. Do NOT re-litigate this via ctx7 — Task 4 Step 0's ctx7 call is scoped to verifying the _argument shape_ (`size`, `quality`, response `b64_json` field), not the model name. Task 4's live-smoke gate (Step 5) will surface any argument-shape mismatch as an SDK exception; a model-name 4xx from the SDK is treated as a fixture/environment problem (e.g. the API key lacks `gpt-image-2` access), NOT a license to revert to `gpt-image-1`.

4. **Inworld TTS model id `inworld-tts-2` (FIXED by user fiat).** The spec was authored before TTS-2 existed and references `inworld-tts-1.5-max`; the user has confirmed `inworld-tts-2` is the current generation. Do NOT revert via ctx7. The `@inworld/tts` SDK call is `InworldTTS().generate({ ..., model: 'inworld-tts-2', encoding: 'OGG_OPUS' })`. The live-smoke test will surface a stale model id as an SDK exception.

5. **`buildFilename` UTC vs local time.** We use UTC to keep filenames deterministic across machines and CI. The fixture image filenames in `commodore-vex/images/` (e.g. `2026-04-26-18-25-11-pyre-conclave.png`) are local-time and dash-separated; our pattern is UTC and uses no dashes between date and time fields (`YYYYMMDD-HHMMSS`). This matches the spec's exact wording (line 367: `YYYYMMDD-HHMMSS-<slug>-<6char-rand>.png`); the legacy local-time filenames are leftover from OpenClaw's pre-collision-suffix era and need no migration.

6. **SDK retries and rate-limits.** Both `@inworld/tts` and the `openai` SDK handle 5xx retries / exponential backoff internally — the wrappers don't add their own retry logic. Risk #6 in earlier revisions was about raw `fetch` in Node 22; with the SDK move it's a non-issue here. If a future incident reveals the SDKs' defaults are too aggressive or too slow, tune via the SDK constructor options (not by replacing the SDK with raw `fetch`).

7. **Test isolation.** vitest's `vi.fn()` is per-test scope by default. We pass the mock client in via `deps`, so there is no global mutation; concurrent test files cannot contaminate each other.

8. **`ffmpeg` dropped from Wave 3.** The legacy mp3→ffmpeg→ogg pipeline is gone — `@inworld/tts` returns OGG bytes natively via `encoding: 'OGG_OPUS'`. No `spawn`, no child process, no `ChildProcessWithoutNullStreams` fakes. Whether ffmpeg is needed elsewhere (waves 5–6, browser-side decoding, etc.) is out of scope for Wave 3.

---

## Self-review checklist (run inline; fix issues as you find them)

These were applied while writing the plan; they're listed here so a reviewer (or the agent re-reading the plan) can re-run them.

1. **Spec coverage — every row of the Wave 3 LOC table has a corresponding task:**
   - `src/lib/schemas.ts` (`FactionOutput`, `NarratorOutput`, `IllustratorOutput`, `ImageMeta`) → **Task 1**.
   - `src/lib/dossier.ts` (3 builders + `identifyOnStage` + `extractVisualBlock`) → **Task 2**.
   - `src/lib/media/tts.ts` (`@inworld/tts` SDK, model `inworld-tts-2`, native `OGG_OPUS` encoding) → **Task 3**.
   - `src/lib/media/image.ts` (`openai` SDK, model `gpt-image-2`, default quality `'high'`, filename pattern with random suffix) → **Task 4**.

2. **Spec exit criteria — every Wave 3 exit criterion in the spec (lines 540–545) maps to a task:**
   - "Dossier builders are pure functions; snapshot tests pass against fixture vault." → **Task 2** Steps 1, 3 (test asserts pure functions + reads `tests/fixtures/test-vault/style-guide.md`).
   - "`tts.ts` produces a non-empty `.ogg` for 'hello world' (live test, but design it so unit tests can stub)." → **Task 3** Step 1 (live-smoke test gated on `INWORLD_API_KEY`; unit tests cover the stubbable seam via `TtsDeps.inworld`, a fake `InworldTtsLike`).
   - "`media/image.ts` writes a `.png` to `vaults/commodore-vex/images/` (live test, stubbable)." → **Task 4** Step 1 (live-smoke test gated on `OPENAI_API_KEY`; unit tests cover the stubbable seam via `ImageDeps.openai`, a fake `OpenAILike`).
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
   - `TtsDeps.inworld` and `ImageDeps.openai` are both structural-type seams (`InworldTtsLike`, `OpenAILike`) covering only the SDK methods the wrappers actually call — no raw `fetch` is exposed in either deps interface.
   - `ttsRender` returns `Promise<string>` (the output path); `generateImage` returns `Promise<ImageMeta>` (per the spec the per-image record is `ImageMeta`, while the per-call audio is just its path).

6. **Reference verbatim.** OpenClaw scripts consulted (historical only — Wave 3 ships against the current SDKs and user-fixed model ids):
   - `inworld-tts/scripts/tts.sh` lines 80–102 — historical URL / modelId / body. Wave 3 supersedes with `@inworld/tts` SDK + `inworld-tts-2` + native `OGG_OPUS`.
   - `rpg-image/scripts/image.py` lines 45, 55–62 — `_VISUAL_RE`, random_slug, build_filename. Our `buildFilename` adds the 6-char random suffix per spec §4 (a deliberate delta from OpenClaw, which only used 4 chars without a time-stamp-collision concern).
   - `gpt-image-1/scripts/generate_image.py` lines 47–66 — historical reference for `client.images.generate({ model, prompt, quality, size, n: 1 })`. Wave 3 supersedes with `openai` SDK + `gpt-image-2` + `quality: 'high'`.

7. **Boundary contract — Wave 3 stays inside `src/lib/` (+ two scoped package.json additions + one vitest.config.ts edit):**
   - No `src/mastra/` files touched.
   - No `src/app/` files touched.
   - No imports from `mastra` or `@mastra/*`.
   - `package.json` gains exactly two new runtime deps: `@inworld/tts` and `openai`. The `@ai-sdk/openai` dep already in package.json is unrelated (it's the Vercel AI SDK's OpenAI provider, for waves 4–5 LLM calls).
   - Revision 1 also widens the boundary to a single `vitest.config.ts` edit (Task 5 Step 1) — that file is in repo-root, not under `src/`, and the change is config-only.

8. **Regex correctness — JS regex tokens only, no Python `\Z`:**
   - `VISUAL_RE` in `dossier.ts` Step 3 is `/^## Visual\s*\n([\s\S]*?)(?=\n## |$(?![\s\S]))/m` — uses `$(?![\s\S])` as the JS-equivalent of Python's `\Z` (true end-of-input), with `m` mode only for the leading `^## Visual` heading anchor. Verified in Node against three cases: `"## Visual\nFirst block.\nSecond line.\n## Other\nignored"` → `"First block.\nSecond line."`; `"## Visual\nOnly block.\nMultiple lines."` → `"Only block.\nMultiple lines."`; `"## Visual\nFixture single sentence."` → `"Fixture single sentence."`. An earlier revision used a plain `$` here, which incorrectly matched at every internal `\n` and truncated multi-line blocks at the first line break — that regression is fixed by the negative-lookahead.
   - No other regex in the plan uses non-JS escapes.

9. **External-API model names — FIXED by user fiat for this wave:**
   - **OpenAI image model = `gpt-image-2`** (NOT `gpt-image-1`; the human owner has corrected this three rounds in a row — do NOT revert). **Default quality = `'high'`** (NOT `'medium'`). Task 4 Step 0 uses ctx7 to verify the _argument shape_ of `client.images.generate` (size enum, quality enum, response field `b64_json`) but does NOT re-litigate the model name.
   - **Inworld TTS model = `inworld-tts-2`** (NOT `inworld-tts-1.5-max`; the spec predates TTS-2). The `@inworld/tts` SDK handles auth from `INWORLD_API_KEY` env var or an `{ apiKey }` constructor arg — no manual Basic/Bearer header. The SDK returns native `OGG_OPUS` bytes via `encoding: 'OGG_OPUS'`, eliminating the legacy mp3→ffmpeg→ogg pipeline.
   - Both wrappers are gated on a successful live-smoke at their respective Task Step 5 — an SDK exception from the live test triggers diagnosis (auth, network, model access), NOT a model-name revert.

10. **Coverage gate scope covers the Wave 3 surface (not just `src/lib/vault/**`):\*\*
    - Task 5 Step 1 extends `vitest.config.ts` `coverage.include` to `['src/lib/vault/**/*.ts', 'src/lib/schemas.ts', 'src/lib/dossier.ts', 'src/lib/media/**/*.ts']` so the 80/80/80/80 threshold applies to schemas + dossier + media too.
    - The previous silent exclusion of Wave 3 files (revision 0) was a coverage-hygiene regression; this revision fixes it.

11. **TS strictness on injected SDK seams.**
    - `makeFakeInworld()` in `tts.test.ts` and `makeFakeOpenAI()` in `image.test.ts` both implement only the SDK method the wrapper actually calls (`generate` and `images.generate` respectively) — the public `InworldTtsLike` / `OpenAILike` structural types are intentionally narrower than the real SDK types so fakes don't have to mirror unused fields. The `defaultClient` factories in `tts.ts` and `image.ts` cast the real SDK instance through `unknown` because the wider SDK types carry fields outside our minimal interface; the cast is contained in one place per module and is the only `as unknown as` in production code.

12. **Filename random-suffix entropy is correctly described.**
    - `buildFilename` uses `crypto.randomBytes(3).toString('hex')` — exactly 6 hex chars = 24 bits ≈ 1 in 16.7 million collisions per slug-second. The docstring and the risk register agree on this number (revision 0 claimed "36 bits ≈ 1 in 2 billion", which contradicted `randomBytes(4).toString('hex').slice(0, 6)` = 24 bits — fixed by switching to `randomBytes(3)` cleanly).

---

## Out of scope (do NOT touch in this wave)

- Wave 4 tools/agents/registration — separate ticket; do not introduce `src/mastra/tools/`, `src/mastra/agents/`, or modify `src/mastra/index.ts`.
- Wave 5 workflow + smoke — separate ticket.
- Wave 6 API route + UI — separate ticket.
- Cleanup of `weather-agent` / `weather-workflow` — out-of-band cleanup per spec line 602.
- The live `vaults/commodore-vex/` symlink target — the image live-smoke test writes there only if writable; otherwise it falls back to a tmp dir.
- v0.5 features: alias resolution in `wikilinks.ts` (still folder-prefix-or-bust), discretionary off-stage faction spawns, per-NPC TTS voices, streaming TTS.
- LLM calls (`generateObject` via the Vercel AI SDK) — those are Wave 4–5 work. Wave 3 produces the Zod schemas that consume them; it does NOT instantiate any LLM client. (See the "SDK choices" section near the top of the plan for the full split between OpenAI image SDK / Inworld TTS SDK / Vercel AI SDK responsibilities.)
- ffmpeg shell-out — dropped from Wave 3 since `@inworld/tts` emits native OGG Opus. Whether ffmpeg returns in Wave 5/6 (browser-side decoding, alternate codecs) stays for those waves to decide.
