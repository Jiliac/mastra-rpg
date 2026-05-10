# mastra-rpg — Runtime Port Design

**Date:** 2026-05-10
**Status:** design (awaiting implementation plan)
**Supersedes (runtime layer only):** the OpenClaw `maz-gm` / `rpg-narrator` / `rpg-faction` skill suite at `/Users/valentin/Development/ai/maz_rpg/openclaw/`. The vault format and faction-trigger semantics from `2026-04-26-openclaw-rpg-skill-design.md` are preserved verbatim.

## Goal

Run the OpenClaw narrative RPG inside a local Next.js + Mastra app, with a chat UI as the player surface and an in-process workflow as the GM. Same vault format, same anti-sycophancy guarantee (deterministic faction trigger), same per-turn artifacts (prose, audio, images, playtest log) — but with the OpenClaw-specific orchestration plumbing (`sessions_spawn`, push completion events, `.outbox/` files, `ANNOUNCE_SKIP`) replaced by a single linear Mastra workflow.

## Non-goals

- Multi-user, auth, deployment. v0 is localhost-only, single user.
- Multi-campaign UI. v0 hardcodes one slug via `.env.local`.
- Prep skill. v0 starts from an existing vault (current target: `commodore-vex`).
- Replay parity with prior turns. v0 plays forward only; back-catalogue is preserved on disk but the runtime never re-derives it.
- OpenClaw co-existence. v0 owns the vault during play. (Re-enabling co-existence via `flock` is a v0.5 concern.)
- Telegram. The chat UI replaces the channel.
- Streaming TTS, mid-turn audio. Audio renders once, after prose is final.
- Mid-turn crash resume. Mirrors OpenClaw's same explicit tradeoff.

## High-level architecture

```
Player input ─► /api/turn (SSE)
                  │
                  ▼
        ┌────────────────────────────────────────────┐
        │ workflow: src/mastra/workflows/turn.ts     │
        │                                            │
        │  Step 1: lock + dossier (read vault)       │
        │                                            │
        │  Step 2: Factions ──┐                      │
        │   parallel fan-out  │  GPT 5.5 × N         │
        │   {decision,        │                      │
        │    reasoning}       │                      │
        │                  ◄──┘                      │
        │                                            │
        │  Step 3: Narrator ── GPT 5.5               │
        │   { prose, time_passed? }                  │
        │   tools: loadEntity, dice                  │
        │   streamObject → SSE prose deltas          │
        │                                            │
        │  Step 4 (parallel):                        │
        │   ├─ Illustrator ── GPT 5.5                │
        │   │  tools: image (gpt-image-2)            │
        │   │  fires 0-3 parallel image tool calls   │
        │   │  returns { prose_with_embeds, images } │
        │   │                                        │
        │   └─ TTS (Inworld TTS 2) ── audio file     │
        │      input = narrator prose with           │
        │      [[wikilinks]] stripped                │
        │                                            │
        │  Step 5: persist                           │
        │   - append journal (final prose)           │
        │   - world_tick if requested                │
        │   - stub-on-mention (cap 2)                │
        │   - playtest log                           │
        │   - release lock (in `finally`)            │
        └────────────────────────────────────────────┘
                          │
                          ▼
                  ./vaults/commodore-vex (symlink)
```

### Why this shape

- **One workflow, three agents.** OpenClaw's three operational modes (Mode A/B/C in `maz-gm/SKILL.md`) exist because `sessions_spawn` is non-blocking and completion events arrive as push messages spanning LLM turns. Mastra's `await agent.generate()` is blocking; the entire state machine collapses to one async function.
- **Narrator is lightweight.** Pure prose + a small declarative directive (`time_passed?`) and two read-only tools (`loadEntity`, `dice`). No tool calls that produce vault writes. No image generation, no audio rendering, no journal writing. Dice rolls happen via the `dice` tool live mid-prose; Mastra's tool-call history is what gets surfaced to the playtest log — no redundant `rolls` directive in structured output. The narrator owns _content_; the workflow owns _execution_.
- **Illustrator is its own agent.** Visual selection is a distinct craft from prose-writing; offloading it (a) protects the narrator's cognitive budget, (b) lets illustrator's image tool calls run in parallel inside its run, (c) lets illustration run in parallel with TTS at the workflow level.
- **TTS is workflow-level.** Mechanical post-processing — strip wikilinks, render audio, save to disk. No agent judgment required.
- **Vault is the only persisted state between turns.** No Mastra Memory, no DB. Dossier rebuilt from disk every turn (matches the OpenClaw spec's tiered-loading model exactly).

## Component layout

```
mastra-rpg/
├─ vaults/
│  └─ commodore-vex → /Users/valentin/Development/ai/maz_rpg/rpg/commodore-vex   (symlink)
│
├─ src/
│  ├─ app/
│  │  ├─ play/[slug]/page.tsx                    # the chat UI
│  │  └─ api/turn/route.ts                       # POST → SSE; runs the workflow
│  │
│  ├─ mastra/
│  │  ├─ index.ts                                 # Mastra() with agents + workflows + tools registered
│  │  ├─ workflows/
│  │  │  └─ turn.ts                               # 5-step workflow (the GM)
│  │  ├─ agents/
│  │  │  ├─ narrator.ts                           # GPT 5.5, high effort, structured output
│  │  │  ├─ faction.ts                            # GPT 5.5, high effort, structured output
│  │  │  └─ illustrator.ts                        # GPT 5.5, high effort, image tool
│  │  └─ tools/
│  │     ├─ dice.ts                               # mid-prose roll (narrator only, rare)
│  │     ├─ loadEntity.ts                         # read npc/faction/location (all agents, read-only)
│  │     └─ image.ts                              # gpt-image-2 + style-guide ## Visual prepend
│  │
│  └─ lib/
│     ├─ vault/                                   # pure TS, no Mastra dependency
│     │  ├─ paths.ts                              # vault root resolution, slug-relative paths
│     │  ├─ frontmatter.ts                        # parse YAML frontmatter (gray-matter)
│     │  ├─ xml.ts                                # read/write world.xml, threads.xml, character.xml
│     │  ├─ entities.ts                           # listFactions, loadNpc, loadLocation, loadFaction
│     │  ├─ journal.ts                            # parseRecentEntries(N), append(turnId, prose)
│     │  ├─ wikilinks.ts                          # parse, resolve, findUnresolved
│     │  ├─ stubs.ts                              # createStub from prose excerpt
│     │  ├─ turnId.ts                             # mint (read+increment .turn-counter)
│     │  ├─ lock.ts                               # in-memory mutex, hot-reload safe
│     │  ├─ playtests.ts                          # append per-day log under playtests/
│     │  └─ threads.ts                            # worldTick: tick clocks, return matured
│     │
│     ├─ media/
│     │  ├─ tts.ts                                # Inworld TTS 2 → mp3 → ffmpeg → ogg
│     │  └─ image.ts                              # OpenAI gpt-image-2 wrapper + filename gen
│     │
│     ├─ dossier.ts                               # build NarratorDossier, FactionDossier, IllustratorDossier
│     └─ schemas.ts                               # Zod: NarratorOutput, FactionOutput, IllustratorOutput, ImageMeta
│
├─ .env.local                                     # OPENAI_API_KEY, INWORLD_API_KEY, VAULT_SLUG=commodore-vex
└─ package.json                                   # adds: gray-matter, fast-xml-parser, ai, @ai-sdk/openai
```

### Boundaries

- `src/lib/vault/` is pure TypeScript — no Mastra, no AI SDK, no provider deps. Unit-testable in isolation. Mirrors what `state.py` does in OpenClaw.
- `src/mastra/tools/` are thin adapters over `src/lib/`. The `image` tool, e.g., is `createTool({ inputSchema, execute: ({ prompt, slug }) => mediaImage.generate(prompt, slug) })`.
- `src/lib/dossier.ts` is the only file that knows how to assemble agent input from vault state. Three pure functions: `buildFactionDossier`, `buildNarratorDossier`, `buildIllustratorDossier`. No I/O — takes pre-loaded entity objects.
- `src/mastra/workflows/turn.ts` is the orchestration spine.
- `src/app/api/turn/route.ts` bridges the workflow's emitted events to the browser via SSE.

### Deliberately not built

- No `submit_*` tools — structured output replaces them.
- No `.outbox/` directory.
- No subprocess CLI for vault ops.
- No Mastra Memory.
- No Telegram client.
- No Obsidian-MCP integration.

## Data flow

### Output schemas (Zod, in `src/lib/schemas.ts`)

```ts
const FactionOutput = z.object({
  decision: z.string().min(1),
  reasoning: z.string().min(1),
});

const NarratorOutput = z.object({
  prose: z.string().min(1),
  time_passed: z
    .object({
      days: z.number().int().nonnegative().optional(),
      hours: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

const IllustratorOutput = z.object({
  prose_with_embeds: z.string().min(1),
  images: z.array(
    z.object({
      filename: z.string(),
      path: z.string(),
      prompt: z.string(),
      slug: z.string(),
    }),
  ),
});
```

### Per-turn workflow

```
Step 1 — Lock & dossier prep
─────────────────────────────
  acquireMutex(slug)                          // throws if held
  turnId = mintTurnId(slug)                   // turn-NNN
  loaded = loadAlwaysLoaded(slug)             // 0-Map, world, character, threads, style-guide, factions/*
  recent = parseRecentJournal(slug, n=5)
  entities = await Promise.all(
    recent.unresolvedSlugs.map(loadEntity)
  )
  onStage = identifyOnStage(playerInput, recent, entities)
  factionsToSpawn = dedupeBySlug(
    onStage.npcs.filter(n => n.frontmatter.faction).map(n => n.frontmatter.faction)
  )
  // No skip-with-reason log: on-stage detection is deterministic in v0,
  // there's no judgment call to audit. The list of factions actually spawned
  // is what lands in playtests.
  emit("phase", { name: "factions", count: factionsToSpawn.length })


Step 2 — Faction fan-out (parallel)
────────────────────────────────────
  decisions = await Promise.all(
    factionsToSpawn.map(slug => {
      const dossier = buildFactionDossier({
        faction: loaded.factions[slug],
        on_stage: onStage,
        recent,
        world: loaded.world,
        character: loaded.character,
        playerInput,
      })
      return factionAgent.generate(dossier, {
        output: FactionOutput,
        reasoningEffort: 'high',
      })
    })
  )
  // Validation failure → retry once with feedback. Second failure → synthesize
  //   { decision: "[no response]", reasoning: "[validation failed twice]" } and continue.
  emit("phase", { name: "narrator" })


Step 3 — Narrator
──────────────────
  dossier = buildNarratorDossier({
    world, character, style_guide, on_stage, recent_journal,
    faction_decisions: decisions.map(d => ({ slug, decision: d.decision })),
    player_input: playerInput,
    turn_id: turnId,
  })
  stream = narratorAgent.streamObject(dossier, {
    output: NarratorOutput,
    reasoningEffort: 'high',
    tools: { loadEntity, dice },               // worldTick is NOT a tool; it's an output directive
  })
  for await (chunk of stream) emit("prose_delta", chunk.delta)
  narratorOutput = await stream.object
  emit("phase", { name: "media" })


Step 4 — Illustrator || TTS  (parallel)
────────────────────────────────────────
  [illustratorOutput, audioPath] = await Promise.all([
    illustratorAgent.generate(
      buildIllustratorDossier({
        narrator_prose: narratorOutput.prose,
        style_guide_visual: extractVisualBlock(style_guide),
        on_stage,
      }),
      {
        output: IllustratorOutput,
        reasoningEffort: 'high',
        tools: { image },
      }
    ),
    ttsRender(stripForTts(narratorOutput.prose), {
      voice: 'Hank',
      output: `${vaultRoot}/audio/narrator-${turnId}.ogg`,
    }),
    // stripForTts: replaces [[npcs/kessha|Kessha]] → "Kessha"; [[npcs/kessha]] → "kessha"
    //              (slug deslugified at the kind-folder boundary); narrator's prose has no
    //              ![[image]] embeds yet (illustrator inserts those), so nothing else to strip.
  ])
  finalProse = illustratorOutput.prose_with_embeds
  emit("phase", { name: "persist" })


Step 5 — Persist
─────────────────
  if (narratorOutput.time_passed) {
    matured = worldTick(slug, narratorOutput.time_passed)
    // matured threads consumed by NEXT turn's dossier
  }
  appendJournal(slug, turnId, finalProse)
  unresolvedLinks = findUnresolvedWikilinks(finalProse)
  for (link of unresolvedLinks.slice(0, 2)) createStub(slug, link, finalProse)
  appendOverflowToMap(slug, unresolvedLinks.slice(2))
  appendPlaytest(slug, turnId, {
    factionDecisions: decisions,                // INCLUDING reasoning
    narratorTokens: stream.usage,
    narratorToolCalls: stream.toolCalls,         // dice rolls + loadEntity reads, captured by Mastra
    illustratorImageCount: illustratorOutput.images.length,
    audioPath,
    duration_ms,
  })
  // releaseMutex(slug) lives in `finally` of the wrapping try block
  emit("done", { audioPath, finalProse, images: illustratorOutput.images })
```

### Phase events (SSE)

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

UI shows the phase tape on the right column, prose streams in the main column, audio + images appear at `done`.

### Faction trigger rule

- **Mandatory:** every on-stage NPC with `faction:` frontmatter → spawn that faction. Deduplicate by faction slug.
- **Discretionary spawns** (off-stage factions whose news radius the player's action enters): **deferred to v0.5.** v0 only does mandatory spawns to keep the trigger 100% deterministic and remove a judgment call.
- **Skip-with-reason audit log** (OpenClaw's `player_alone | npc_is_color_only | faction_already_spawned_within_3_turns_no_new_input` enum) is **not ported**. OpenClaw needed it because an LLM-driven GM might silently skip mandatory spawns and the enum forced an explicit, grep-able audit. v0's GM is deterministic code — there is no judgment call to audit. The playtest log records which factions actually spawned; that's the audit trail.

### Stub-on-mention

- Parse final prose for wikilinks. Folder-prefix is preferred — `[[npcs/kessha]]`, `[[locations/iron-promise]]`, `[[factions/free-fleet-of-the-sisar]]`. Bare `[[Foo]]` resolves via aliases against all three folders.
- **Kind-resolution for unresolved bare links** (no folder prefix, no alias hit): default to `npc`. Mirrors OpenClaw's `find_new_wikilinks` behavior.
- Up to 2 unresolved → stubs (per-turn cap), seeded with the sentence containing the link plus one sentence on each side.
- Stub frontmatter: `{ aliases: [], tags: [<kind>, stub], created: <world.xml date>, status: stub, first_mention: turnId }`.
- Excess unresolved links → appended as `- TODO: stub for [[<link>]] (turn-NNN)` in `0-Map.md`.

### Models, voices, providers

| Layer            | Provider / model     | Notes                                                                                                                                                |
| ---------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| All 3 agents     | `openai/gpt-5.5`     | `reasoningEffort: 'high'` baseline; tunable per-agent                                                                                                |
| Image generation | OpenAI `gpt-image-2` | Style-guide `## Visual` block prepended to every prompt; same wrapper logic as OpenClaw `image.py` (filename pattern updated, see Error handling §4) |
| TTS              | Inworld TTS v2       | Default voice `Hank`; per-NPC voices deferred to v0.5; mp3 → ffmpeg → ogg pipeline preserved                                                         |

The exact Inworld TTS v2 model id is to be verified against Inworld docs at implementation time (current OpenClaw script uses `inworld-tts-1.5-max`).

## Error handling

### Failure matrix

| Failure                                | Detection                                  | Recovery                                                                                           | User-facing                                                    |
| -------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Mutex contention (double-send)         | `acquireMutex` returns false synchronously | Reject second request immediately                                                                  | `error: "still working", recoverable: true`; UI disables input |
| Faction schema validation fails (1st)  | Zod throws                                 | Retry once with validation error in prompt                                                         | Silent — phase event `factions: 2/3 retrying`                  |
| Faction schema validation fails (2nd)  | Zod throws again                           | Synthesize `{ decision: "[no response]", reasoning: "[validation failed twice]" }`, continue       | Silent — logged in playtests                                   |
| Narrator schema validation fails (1st) | Zod throws                                 | Retry once                                                                                         | Phase event `narrator: retrying`                               |
| Narrator schema validation fails (2nd) | Zod throws again                           | Abort turn, skip persist, release mutex                                                            | `error: "narrator failed; please rephrase"`, recoverable=true  |
| Image generation 5xx / timeout         | OpenAI API error in `image` tool           | Tool returns error; illustrator drops that embed and continues                                     | Silent — illustrator's image count just lower                  |
| Illustrator schema validation fails    | Zod throws                                 | Retry once; on second failure, journal narrator's prose **without** image embeds                   | Phase event flagged; turn still completes                      |
| TTS API failure                        | Inworld returns non-200 OR ffmpeg fails    | Retry once with backoff. Second failure: abort turn, skip persist                                  | `error: "audio render failed"`, recoverable=true               |
| ffmpeg not on PATH                     | spawn ENOENT at startup                    | Fail at startup with a clear message                                                               | Server won't start                                             |
| Filesystem write fails                 | `fs.writeFile` rejects                     | Abort turn at the failing step, skip remaining persist, release mutex                              | `error: "vault write failed: <reason>"`, recoverable=false     |
| Workflow process crash mid-turn        | uncaught throw                             | Mutex was in-memory — released on process death; turn-counter MAY waste an ID (gaps explicitly OK) | Player retries; their input was lost                           |
| UI disconnects mid-stream              | SSE connection closes                      | Workflow continues server-side; on next page load, journal shows the completed turn                | Player sees the turn appear on reload                          |
| `loadEntity` slug not found            | Entity file missing                        | Tool returns `{ found: false }`; agent decides whether to use a stub or skip                       | Silent                                                         |
| `dice` invalid expression              | Parser throws                              | Tool returns the error; agent retries with a valid expression                                      | Silent                                                         |

### Concurrency invariants

These are non-negotiable and enforced by code, not convention:

1. **Mutex release lives in `finally`.** Any uncaught throw in `runTurn` would otherwise deadlock the slug until process restart.

   ```ts
   try { await runTurn(slug, ...) }
   finally { releaseMutex(slug) }
   ```

2. **Lock map survives Next.js hot-reload (dev).** Module-scoped `Map` recreates on hot-reload, dropping held state. Use `globalThis`:

   ```ts
   const g = globalThis as { __rpg_locks?: Map<string, Promise<void>> };
   g.__rpg_locks ??= new Map();
   ```

3. **Workflow does NOT propagate the request's `AbortSignal`.** Client-disconnect must not abort the workflow — that would leave a half-persisted turn (audio rendered, journal not appended). SSE is a window onto a fire-and-forget background task.

4. **Image filename includes random suffix.** Pattern: `YYYYMMDD-HHMMSS-<slug>-<6char-rand>.png`. Guards against same-second collisions when illustrator fires parallel image generations.

### Documented limitation (v0)

No safety against external writers (Obsidian saving `journal.md` mid-turn, OpenClaw running on the same vault). The symlink target is a working Obsidian vault, so the risk exists. Mitigation deferred to v0.5 (OS-level `flock` if/when OpenClaw co-existence becomes a goal again).

### Non-failures explicitly handled as success

- **Empty image list** — illustrator decided no scene warranted illustration. Journal entry has no `![[…]]` embeds. Fine.
- **Empty faction list** — no on-stage NPCs with faction frontmatter, no discretionary spawns (which v0 doesn't do anyway). Workflow skips Step 2; narrator gets a dossier with empty `<faction_decisions>`. Mirrors a "the player is alone" beat.

## Testing

### Layer 1 — Vault library unit tests (vitest)

Pure-TS modules in `src/lib/vault/`. Most of the bug surface lives here (parsers, resolvers, wikilink edge cases, clock arithmetic) and tests are cheapest. Coverage target: **80%+**.

A small fixture vault at `tests/fixtures/test-vault/` exercises every code path: 2 factions, 3 NPCs (one with `faction:`), 2 locations, a `journal.md` with mixed heading formats, a `threads.xml` with mixed clock states.

| Module           | Tests                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `frontmatter.ts` | parses YAML; preserves arrays; handles missing fields; rejects malformed                                                |
| `xml.ts`         | round-trips world.xml; threads.xml mutation preserves whitespace; character.xml repeated `<faction>` tags handled       |
| `wikilinks.ts`   | `[[npcs/foo]]` resolves; `[[Foo]]` matches via aliases; folder-prefix overrides slug-only; unresolved returns kind+slug |
| `journal.ts`     | `parseRecentEntries(5)` handles format drift; `append` heading derived from `world.xml` date                            |
| `stubs.ts`       | excerpt extraction returns sentence + neighbors; alias extraction is best-effort but safe                               |
| `turnId.ts`      | monotonic; tolerates gaps; pads to 3 digits                                                                             |
| `lock.ts`        | second `acquire` returns false synchronously; `release` allows next; `finally` semantics; survives hot-reload           |
| `threads.ts`     | `worldTick({days:1})` advances every clock; matured threads returned; on-disk state correct                             |
| `playtests.ts`   | appends to per-day file; creates if missing; `## turn-NNN` heading matches OpenClaw                                     |

### Layer 2 — Workflow integration tests (vitest)

Mock the three agents (canned outputs). Mock TTS + image generation (predictable file paths, empty bytes). Run `turn.ts` against fixture vault.

1. **Happy path.**
2. **Faction validation fail × 2** → synthesized `[no response]`, continues.
3. **Narrator validation fail × 2** → workflow surfaces error, no journal append.
4. **Concurrent turns** → second resolves with mutex-contention error.
5. **Image gen failure** → illustrator drops that embed; turn completes.
6. **TTS failure × 2** → workflow surfaces error, no journal append.
7. **Crash mid-step** → mutex released via `finally`, no partial journal entry.
8. **Stub cap** → 5 unresolved wikilinks → 2 stubs created, 3 in `0-Map.md` TODOs.

### Layer 3 — Live smoke test (manual)

```bash
pnpm tsx scripts/smoke-turn.ts \
  --vault tests/fixtures/test-vault-copy \
  --input "I want to confront the harbormaster about the missing manifest"
```

Real OpenAI + Inworld. Verifies end-to-end: journal appended, audio file exists, 0+ images exist, playtest entry exists. Run before declaring v0 done and after non-trivial changes. Not part of CI.

### Out of scope

- UI rendering (manual browser test for v0).
- Provider model behavior (tuning, not correctness).
- OpenAI/Inworld API contracts (external, trust the error matrix).
- Cross-platform paths (macOS only for v0).
- Performance benchmarks (LLM-dominated; we can't test against it).

## Open questions deferred to v0.5

- Discretionary off-stage faction spawns (judgment-based; needs a small LLM call or a heuristic).
- Per-NPC TTS voices.
- Vault browser UI (currently delegated to Obsidian).
- Campaign picker / multi-campaign UI.
- OpenClaw co-existence on the same vault (`flock`-based external locking).
- Crash-resume of mid-turn state.
- Prep skill port (Session Zero + research → vault generation).

## What carries over from `2026-04-26-openclaw-rpg-skill-design.md`

- Vault format (XML + Markdown + YAML frontmatter) — verbatim.
- Faction-trigger rule (mandatory = on-stage NPCs with `faction:` frontmatter) — verbatim. The OpenClaw skip-reason enum is intentionally dropped (see "Skip-with-reason audit log" above).
- Stub-on-mention with cap of 2/turn and 0-Map TODO overflow — verbatim.
- Identifier formats (`turn-NNN`, `faction-<slug>-<turn-id>`, `narrator-<turn-id>`) — verbatim.
- Tiered loading (always-loaded / wikilink-driven / on-demand) — verbatim.
- Style guide `## Visual` block as the visual contract for image generation — verbatim.
- Playtest log per-day file with per-turn `## turn-NNN` summary blocks — verbatim.
- World tick semantics (clocks tick by elapsed time/hours, matured threads consumed by next turn) — verbatim, but the trigger is now `narrator.time_passed` directive instead of GM judgment.

## What does NOT carry over

- `sessions_spawn` and the Mode A/B/C state machine.
- `submit_narration` / `submit_decision` CLI scripts.
- `<vault>/.outbox/<spawn_id>.json` files.
- `ANNOUNCE_SKIP` / `expectsCompletionMessage` chat-noise machinery.
- `<vault>/.lock` flock file (replaced by in-process mutex).
- `state.py` Python CLI (replaced by `src/lib/vault/` TS modules).
- Telegram delivery (replaced by SSE chat UI).
- Pre-registration of agent IDs in `openclaw.json` (replaced by Mastra agent definitions).
- Retry-with-`-retry1`-spawn-id-suffix machinery (replaced by Zod retry-with-feedback).

## Implementation waves

Build order. Each wave targets ~300-500 LOC of production TypeScript (tests, JSON, and config don't count toward the budget but live alongside their wave). Total estimated production code: ~2,300 LOC.

After every wave the codebase must compile, lint clean, and the prior wave's tests must still pass. Each wave is independently shippable — stopping after any of them leaves a coherent partial system.

### Wave 0 — Prep (not "real code")

Deps, scaffolding, infra. Not counted in the LOC budget.

- Add deps: `gray-matter`, `fast-xml-parser`, `ai`, `@ai-sdk/openai`, `zod` (already present), `vitest`, `@vitest/coverage-v8`.
- Create `vaults/` and symlink `vaults/commodore-vex → /Users/valentin/Development/ai/maz_rpg/rpg/commodore-vex`.
- `.env.local`: `OPENAI_API_KEY`, `INWORLD_API_KEY`, `VAULT_SLUG=commodore-vex`.
- `vitest.config.ts` with coverage gate at 80% for `src/lib/vault/`.
- Verify `ffmpeg` on PATH (fail-fast check at server startup, see error matrix).

### Wave dependency graph

```
W0 ──► W1 ──► W2 ──► W3 ──► W4 ──► W5 ──┐
                                         ├──► (done)
                                  W6 ───┘
```

- **W1 → W2 is sequential.** W2's `journal.ts`, `stubs.ts`, `threads.ts`, `turnId.ts`, `lock.ts` all depend on types or helpers from W1 (`paths.ts`, `xml.ts`, `wikilinks.ts`). Parallelizing requires locking W1's interfaces first and coding W2 against stubs — overhead exceeds the gain for a solo dev.
- **W3 → W4 → W5 is sequential.** Tools wrap media; agents use schemas; workflow orchestrates agents.
- **W5 ↔ W6 can run in parallel.** The `PhaseEvent` union (see "Phase events (SSE)" §) is the contract. W6 builds the UI against a mock event-stream emitter; the API route swaps in the real workflow at integration time. This is the only true parallel pair.

### Wave 1 — Vault read-side (~360 LOC)

Pure TS, no Mastra. Loads vault state into memory.

| File                                                         |  LOC |
| ------------------------------------------------------------ | ---: |
| `src/lib/vault/paths.ts`                                     |  ~30 |
| `src/lib/vault/frontmatter.ts`                               |  ~30 |
| `src/lib/vault/xml.ts`                                       | ~100 |
| `src/lib/vault/entities.ts` (incl. `loadAlwaysLoaded`)       |  ~80 |
| `src/lib/vault/wikilinks.ts` (parse, resolve, `stripForTts`) | ~120 |

**Exit criteria:**

- `pnpm vitest src/lib/vault` green for these modules.
- Can call `loadAlwaysLoaded('commodore-vex')` and get 0-Map, world, character, threads, style-guide, factions/\* into typed objects.
- Wikilink parser handles `[[npcs/foo]]`, `[[Foo]]` (alias-resolved), and bare unresolved (defaults to `npc`).

**Risk:** `xml.ts` round-trip-preserving-whitespace may push over 100 LOC if `fast-xml-parser` defaults don't behave. If a custom thin serializer is needed, budget +50 LOC (W1 → ~410).

### Wave 2 — Vault write-side + state (~430 LOC)

Mutating ops, locking, per-turn artifacts.

| File                                                                             |  LOC |
| -------------------------------------------------------------------------------- | ---: |
| `src/lib/vault/turnId.ts`                                                        |  ~40 |
| `src/lib/vault/lock.ts` (with `globalThis` HMR guard)                            |  ~50 |
| `src/lib/vault/journal.ts` (parse + append, derives heading from world.xml date) | ~100 |
| `src/lib/vault/stubs.ts` (excerpt extraction, frontmatter generation)            |  ~80 |
| `src/lib/vault/threads.ts` (`worldTick`, returns matured)                        | ~100 |
| `src/lib/vault/playtests.ts` (per-day file append)                               |  ~60 |

**Exit criteria:**

- All vault-lib unit tests green; coverage ≥80%.
- `worldTick({days: 1})` correctly advances every clock and returns the matured-thread list.
- Mutex `acquire`/`release` is synchronous, contention returns false, and the lock survives Next.js hot-reload (`globalThis` map verified by manual test).
- `appendJournal` writes a heading whose date matches `world.xml`.

### Wave 3 — Schemas, dossiers, media (~410 LOC)

Contracts and external-service wrappers.

| File                                                                                       |  LOC |
| ------------------------------------------------------------------------------------------ | ---: |
| `src/lib/schemas.ts` (`FactionOutput`, `NarratorOutput`, `IllustratorOutput`, `ImageMeta`) |  ~50 |
| `src/lib/dossier.ts` (3 builders + `identifyOnStage` + `extractVisualBlock`)               | ~200 |
| `src/lib/media/tts.ts` (Inworld TTS 2 → mp3 → ffmpeg → ogg)                                |  ~80 |
| `src/lib/media/image.ts` (gpt-image-2 wrapper, filename pattern with random suffix)        |  ~80 |

**Exit criteria:**

- Dossier builders are pure functions; snapshot tests pass against fixture vault.
- `tts.ts` produces a non-empty `.ogg` for "hello world" (live test).
- `media/image.ts` writes a `.png` to `vaults/commodore-vex/images/` (live test).
- Filename collisions impossible: `YYYYMMDD-HHMMSS-<slug>-<6char-rand>.png`.

### Wave 4 — Tools, agents, registration (~380 LOC)

Mastra surface. Thin adapters over `src/lib/`.

| File                                                          | LOC |
| ------------------------------------------------------------- | --: |
| `src/mastra/tools/dice.ts`                                    | ~50 |
| `src/mastra/tools/loadEntity.ts`                              | ~40 |
| `src/mastra/tools/image.ts` (calls `lib/media/image.ts`)      | ~40 |
| `src/mastra/agents/narrator.ts` (system prompt + tool wiring) | ~80 |
| `src/mastra/agents/faction.ts`                                | ~80 |
| `src/mastra/agents/illustrator.ts`                            | ~80 |
| `src/mastra/index.ts` updates (register all three)            | ~10 |

**Exit criteria:**

- All three agents callable from Mastra Studio (`pnpm dev`) with hand-built dossiers.
- `dice` tool handles `2d6+1`, `pbta+2`, advantage/disadvantage; invalid expressions return a tool error (agent retries).
- `loadEntity` returns `{ found: false }` for missing slugs; agents handle gracefully.
- Existing `weather-agent` / `weather-workflow` removed from registration.

### Wave 5 — Workflow + smoke (~350 LOC)

The orchestration spine.

| File                                                                             |  LOC |
| -------------------------------------------------------------------------------- | ---: |
| `src/mastra/workflows/turn.ts` (5 steps, retry-with-feedback, `finally`-release) | ~320 |
| `scripts/smoke-turn.ts` (CLI: `--vault`, `--input`)                              |  ~30 |

**Exit criteria:**

- Layer 2 integration tests (8 scenarios per Testing §) all green with mocked agents and media.
- `pnpm tsx scripts/smoke-turn.ts --vault tests/fixtures/test-vault-copy --input "..."` produces: journal entry appended, audio file exists, 0+ images exist, playtest entry exists. Real OpenAI + Inworld.
- Mutex always released even if any step throws (test by injecting failures at every step).

### Wave 6 — API + UI (~370 LOC)

Player surface. Can run in parallel with W5 against a mock event-emitter.

| File                                                                                  |  LOC |
| ------------------------------------------------------------------------------------- | ---: |
| `src/app/api/turn/route.ts` (POST → SSE bridge)                                       | ~120 |
| `src/app/play/[slug]/page.tsx` (chat, prose stream, phase tape, audio + image render) | ~250 |

**Exit criteria:**

- Browser at `localhost:3000/play/commodore-vex` plays a full turn end-to-end.
- Phase tape updates on each `phase` event; prose streams via `prose_delta`; audio + images appear at `done`.
- SSE disconnect mid-stream does NOT abort the workflow (per concurrency invariant #3); on page reload the journal shows the completed turn.
- Mutex contention surfaces as `error: "still working"` and disables input until the in-flight turn completes.

**Risk:** UI LOC is the softest estimate. With existing `src/components/ai-elements/*` (`agent.tsx`, `reasoning.tsx`, `tool.tsx`, etc.) it could land under 200; a richer UX could push past 450.

### Out-of-band cleanup (any time after W4)

Not a wave — housekeeping that doesn't fit the LOC frame.

- Delete `src/mastra/agents/weather-agent.ts` and `src/mastra/workflows/weather-workflow.ts`.
- Delete `src/app/page.tsx` "hello world chat" or repurpose it as a campaign-picker placeholder.
