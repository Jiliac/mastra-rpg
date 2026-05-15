/**
 * Per-turn workflow orchestration (Wave 5).
 *
 * Exports:
 *   - `runTurn(input, deps)` — the single async orchestrator. Five logical
 *     steps, mutex held across all of them, released in `finally`.
 *   - `turnWorkflow` — a `createWorkflow` shell so Mastra Studio observes the
 *     run. The shell delegates to `runTurn` via a single `createStep`.
 *   - `PhaseEvent` / `PhaseEventEmitter` — the Wave-5 ↔ Wave-6 SSE contract.
 *
 * The actual orchestration is a regular async function (not a chain of
 * createSteps) for three reasons documented in the plan: (1) we need a single
 * try/finally around all five steps to release the mutex on every code path;
 * (2) `prose_delta` events from the narrator stream fire inside Step 3 anyway,
 * so per-step workflow events would not give us per-event granularity for
 * free; (3) testing a regular async function is dramatically simpler than
 * driving `createRun().start()` and digging through step envelopes.
 *
 * The retry policy is implemented twice with different shapes:
 *   - `generateWithRetry` for faction + illustrator (silent fallback on 2nd fail).
 *   - `streamNarratorWithRetry` for narrator (tagged throw on 2nd fail; retry
 *     uses non-streaming `generate(...)` so no prose_delta events fire on the
 *     second attempt — acceptable per spec).
 *
 * ffmpeg note: TTS goes through `@inworld/tts`, which returns OGG Opus bytes
 * directly. No ffmpeg on the path. The spec's "ffmpeg ENOENT" failure mode
 * does not apply to Wave 5.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z, type ZodTypeAny } from 'zod';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import {
  FactionOutput as FactionOutputSchema,
  IllustratorOutput as IllustratorOutputSchema,
  type FactionOutput,
  type IllustratorOutput,
  type ImageMeta,
  type NarratorOutput,
} from '@/lib/schemas';
import { acquireMutex, releaseMutex } from '@/lib/vault/lock';
import { mintTurnId } from '@/lib/vault/turnId';
import {
  loadAlwaysLoaded,
  loadNpc,
  loadLocation,
  type AlwaysLoaded,
  type EntityDoc,
} from '@/lib/vault/entities';
import { parseRecentEntries, appendJournal, type JournalEntry } from '@/lib/vault/journal';
import { worldTick, type MaturedThread } from '@/lib/vault/threads';
import { appendPlaytest } from '@/lib/vault/playtests';
import { createStub } from '@/lib/vault/stubs';
import { npcsDir, locationsDir, zeroMapPath } from '@/lib/vault/paths';
import {
  parseWikilinks,
  resolveWikilink,
  stripForTts,
  type AliasRegistry,
} from '@/lib/vault/wikilinks';
import {
  identifyOnStage,
  buildFactionDossier,
  buildNarratorDossier,
  buildIllustratorDossier,
  extractVisualBlock,
} from '@/lib/dossier';
import { ttsRender } from '@/lib/media/tts';

// ---- Public types (Wave-5 ↔ Wave-6 contract) -----------------------------

export type PhaseEvent =
  | { type: 'phase'; name: 'factions'; count: number }
  | { type: 'phase'; name: 'narrator' }
  | { type: 'prose_delta'; text: string }
  | { type: 'phase'; name: 'media' }
  | { type: 'phase'; name: 'persist' }
  | { type: 'done'; audioPath: string; finalProse: string; images: ImageMeta[] }
  | { type: 'error'; message: string; recoverable: boolean };

export type PhaseEventEmitter = (event: PhaseEvent) => void;

export interface AgentStreamLike<TOutput> {
  textStream: AsyncIterable<string>;
  object: Promise<TOutput>;
}

export interface AgentLike<TOutput> {
  generate(prompt: string): Promise<{ object: TOutput }>;
  stream(prompt: string): Promise<AgentStreamLike<TOutput>>;
}

export interface RunTurnInput {
  vaultRoot: string;
  playerInput: string;
}

export type RunTurnResult =
  | {
      status: 'success';
      turnId: string;
      finalProse: string;
      audioPath: string;
      images: ImageMeta[];
      matured: MaturedThread[];
    }
  | { status: 'error'; message: string; recoverable: boolean };

export interface RunTurnDeps {
  narratorAgent: AgentLike<NarratorOutput>;
  factionAgent: AgentLike<FactionOutput>;
  illustratorAgent: AgentLike<IllustratorOutput>;
  ttsRender: (text: string, opts: { output: string; voice?: string }) => Promise<string>;
  emit: PhaseEventEmitter;
  now?: () => Date;
}

// ---- Internal helpers / tagged errors ------------------------------------

const NARRATOR_FAILED: unique symbol = Symbol.for('wave5.narrator-failed');
const TTS_FAILED: unique symbol = Symbol.for('wave5.tts-failed');

type TaggedKind = typeof NARRATOR_FAILED | typeof TTS_FAILED;

function taggedError(kind: TaggedKind, message: string): Error & { kind: TaggedKind } {
  const e = new Error(message) as Error & { kind: TaggedKind };
  e.kind = kind;
  return e;
}

function isTaggedError(err: unknown, kind: TaggedKind): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'kind' in err &&
    (err as { kind: unknown }).kind === kind
  );
}

interface RetryOptions<T> {
  fallback: T;
  label: string;
}

/**
 * Faction + illustrator retry-with-feedback policy. First call; on throw,
 * append the validation error to the prompt and retry once; on second
 * failure, return the fallback. Schema parameter is reserved (Mastra has
 * already validated via the agent's `defaultOptions.structuredOutput`).
 */
export async function generateWithRetry<T>(
  agent: AgentLike<T>,
  prompt: string,
  _schema: ZodTypeAny,
  options: RetryOptions<T>,
): Promise<T> {
  try {
    const res = await agent.generate(prompt);
    return res.object;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const retryPrompt = buildRetryPrompt(prompt, msg);
    try {
      const res = await agent.generate(retryPrompt);
      return res.object;
    } catch (err2) {
      // Silent fall-through; the label is reserved for future structured logging.
      void options.label;
      void err2;
      return options.fallback;
    }
  }
}

/**
 * Narrator streaming + retry policy.
 *
 * Attempt 1 uses `agent.stream(...)` and emits `prose_delta` events for each
 * text chunk consumed from `textStream`. On schema-validation failure, attempt
 * 2 uses non-streaming `agent.generate(...)` with the validation error appended
 * to the prompt — and emits ZERO `prose_delta` events. A second failure throws
 * a tagged narrator-failed error that the outer catch turns into a recoverable
 * error event. Players retry by re-prompting.
 */
async function streamNarratorWithRetry(
  agent: AgentLike<NarratorOutput>,
  prompt: string,
  emit: PhaseEventEmitter,
): Promise<NarratorOutput> {
  try {
    const stream = await agent.stream(prompt);
    for await (const chunk of stream.textStream) {
      if (chunk.length > 0) emit({ type: 'prose_delta', text: chunk });
    }
    return await stream.object;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const retryPrompt = buildRetryPrompt(prompt, msg);
    try {
      const res = await agent.generate(retryPrompt);
      return res.object;
    } catch (err2) {
      const msg2 = err2 instanceof Error ? err2.message : String(err2);
      throw taggedError(NARRATOR_FAILED, msg2);
    }
  }
}

/** TTS retry: first call; on throw, 200ms backoff + retry; second failure → tagged. */
async function ttsWithRetry(
  ttsFn: RunTurnDeps['ttsRender'],
  text: string,
  output: string,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<string> {
  try {
    return await ttsFn(text, { output });
  } catch {
    await sleep(200);
    try {
      return await ttsFn(text, { output });
    } catch (err2) {
      const msg = err2 instanceof Error ? err2.message : String(err2);
      throw taggedError(TTS_FAILED, msg);
    }
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildRetryPrompt(prompt: string, errMsg: string): string {
  return (
    `${prompt}\n\n---\n\nVALIDATION ERROR ON PREVIOUS ATTEMPT:\n${errMsg}\n\n` +
    `Re-emit your response, fixing the schema mismatch. ` +
    `The previous attempt failed validation and was discarded.`
  );
}

// ---- collectAllEntities --------------------------------------------------

async function collectAllEntities(
  root: string,
  loaded: AlwaysLoaded,
  recent: JournalEntry[],
  playerInput: string,
): Promise<EntityDoc[]> {
  const [npcFiles, locFiles] = await Promise.all([
    fs.readdir(npcsDir(root)).catch(() => [] as string[]),
    fs.readdir(locationsDir(root)).catch(() => [] as string[]),
  ]);
  const registry: AliasRegistry = {
    npcs: new Set(npcFiles.filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3))),
    locations: new Set(locFiles.filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3))),
    factions: new Set(Object.keys(loaded.factions)),
  };
  const text = [playerInput, ...recent.map((r) => r.heading + '\n' + r.body)].join('\n');
  const links = parseWikilinks(text);
  const seen = new Set<string>();
  const docs: EntityDoc[] = [];
  for (const link of links) {
    const r = resolveWikilink(link, registry);
    if (r.kind === 'image' || r.kind === 'faction') continue;
    if (!r.found) continue;
    const key = `${r.kind}/${r.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const doc = r.kind === 'npc' ? await loadNpc(root, r.slug) : await loadLocation(root, r.slug);
      docs.push(doc);
    } catch {
      // File deleted between turns — silently skip.
    }
  }
  return docs;
}

// ---- stub-on-mention -----------------------------------------------------

interface StubReport {
  stubsCreated: { kind: 'npc' | 'location' | 'faction'; slug: string; path: string }[];
  overflow: string[];
}

async function stubOnMention(
  root: string,
  registry: AliasRegistry,
  finalProse: string,
  turnId: string,
): Promise<StubReport> {
  const links = parseWikilinks(finalProse);
  const unresolved: { kind: 'npc' | 'location' | 'faction'; slug: string; target: string }[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const r = resolveWikilink(link, registry);
    if (r.kind === 'image') continue;
    if (r.found) continue;
    const key = `${r.kind}/${r.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unresolved.push({ kind: r.kind, slug: r.slug, target: link.target });
  }
  const created: StubReport['stubsCreated'] = [];
  for (const u of unresolved.slice(0, 2)) {
    const result = await createStub(root, { kind: u.kind, slug: u.slug, excerptProse: finalProse });
    if (result.created) created.push({ kind: u.kind, slug: u.slug, path: result.path });
  }
  const overflow: string[] = [];
  if (unresolved.length > 2) {
    const lines = unresolved.slice(2).map((u) => `- TODO: stub for [[${u.target}]] (${turnId})\n`);
    await fs.appendFile(zeroMapPath(root), lines.join(''));
    overflow.push(...unresolved.slice(2).map((u) => u.target));
  }
  return { stubsCreated: created, overflow };
}

// ---- playtest renderer ---------------------------------------------------

function renderPlaytest(args: {
  turnId: string;
  decisions: { slug: string; decision: FactionOutput }[];
  narratorOutput: NarratorOutput;
  illustratorOutput: IllustratorOutput;
  audioPath: string;
  matured: MaturedThread[];
  stubReport: StubReport;
}): string {
  const lines: string[] = [];
  lines.push(`### faction decisions`);
  if (args.decisions.length === 0) lines.push(`- (no factions spawned)`);
  for (const d of args.decisions) {
    lines.push(`- **${d.slug}** — decision: ${d.decision.decision}`);
    lines.push(`  - reasoning: ${d.decision.reasoning}`);
  }
  lines.push(`### narrator`);
  if (args.narratorOutput.time_passed) {
    lines.push(`- time_passed: ${JSON.stringify(args.narratorOutput.time_passed)}`);
  } else {
    lines.push(`- time_passed: (none)`);
  }
  lines.push(`### illustrator`);
  lines.push(`- image_count: ${args.illustratorOutput.images.length}`);
  for (const img of args.illustratorOutput.images) {
    lines.push(`  - ${img.filename}: "${img.prompt}"`);
  }
  lines.push(`### media`);
  lines.push(`- audio: ${args.audioPath}`);
  if (args.matured.length > 0) {
    lines.push(`### matured`);
    for (const m of args.matured) lines.push(`- ${m.id}: ${m.name} (stake: ${m.stake})`);
  }
  if (args.stubReport.stubsCreated.length > 0 || args.stubReport.overflow.length > 0) {
    lines.push(`### stubs`);
    for (const s of args.stubReport.stubsCreated) lines.push(`- created ${s.kind}/${s.slug}`);
    for (const o of args.stubReport.overflow) lines.push(`- overflowed [[${o}]] to 0-Map.md`);
  }
  return lines.join('\n');
}

// ---- runTurn — the orchestrator ------------------------------------------

export async function runTurn(input: RunTurnInput, deps: RunTurnDeps): Promise<RunTurnResult> {
  const slug = path.basename(input.vaultRoot);
  const held = acquireMutex(slug);
  if (!held) {
    deps.emit({ type: 'error', message: 'still working', recoverable: true });
    return { status: 'error', message: 'still working', recoverable: true };
  }
  try {
    // ---- Step 1: lock + dossier prep ----------------------------------
    const turnId = await mintTurnId(input.vaultRoot);
    const loaded = await loadAlwaysLoaded(input.vaultRoot);
    const recent = await parseRecentEntries(input.vaultRoot, 5);
    const allEntities = await collectAllEntities(
      input.vaultRoot,
      loaded,
      recent,
      input.playerInput,
    );
    const onStage = identifyOnStage({
      playerInput: input.playerInput,
      recent,
      entities: allEntities,
    });
    deps.emit({ type: 'phase', name: 'factions', count: onStage.factionsToSpawn.length });

    // ---- Step 2: faction fan-out --------------------------------------
    const decisions = await Promise.all(
      onStage.factionsToSpawn.map(async (factionSlug) => {
        const factionDoc = loaded.factions[factionSlug];
        if (!factionDoc) {
          return {
            slug: factionSlug,
            decision: { decision: '[no response]', reasoning: '[faction file missing]' },
          };
        }
        const dossier = buildFactionDossier({
          faction: factionDoc,
          onStage,
          recent,
          world: loaded.world,
          character: loaded.character,
          playerInput: input.playerInput,
        });
        const decision = await generateWithRetry(deps.factionAgent, dossier, FactionOutputSchema, {
          fallback: { decision: '[no response]', reasoning: '[validation failed twice]' },
          label: `faction(${factionSlug})`,
        });
        return { slug: factionSlug, decision };
      }),
    );
    deps.emit({ type: 'phase', name: 'narrator' });

    // ---- Step 3: narrator (streamed) ----------------------------------
    const narratorDossier = buildNarratorDossier({
      world: loaded.world,
      character: loaded.character,
      threads: loaded.threads,
      styleGuide: loaded.styleGuide.body,
      onStage,
      recent,
      factionDecisions: decisions.map((d) => ({ slug: d.slug, decision: d.decision.decision })),
      playerInput: input.playerInput,
      turnId,
    });
    const narratorOutput = await streamNarratorWithRetry(
      deps.narratorAgent,
      narratorDossier,
      deps.emit,
    );
    deps.emit({ type: 'phase', name: 'media' });

    // ---- Step 4: illustrator || TTS -----------------------------------
    const visualBlock = extractVisualBlock(loaded.styleGuide.body) ?? '';
    const illustratorDossier = buildIllustratorDossier({
      narratorProse: narratorOutput.prose,
      styleGuideVisual: visualBlock,
      onStage,
    });
    const audioPath = path.join(input.vaultRoot, 'audio', `narrator-${turnId}.ogg`);
    const [illustratorOutput, audioPathResolved] = await Promise.all([
      generateWithRetry(deps.illustratorAgent, illustratorDossier, IllustratorOutputSchema, {
        fallback: { prose_with_embeds: narratorOutput.prose, images: [] },
        label: 'illustrator',
      }),
      ttsWithRetry(deps.ttsRender, stripForTts(narratorOutput.prose), audioPath),
    ]);

    // ---- Step 5: persist (only reached on full success) ---------------
    deps.emit({ type: 'phase', name: 'persist' });
    let matured: MaturedThread[] = [];
    if (narratorOutput.time_passed) {
      matured = await worldTick(input.vaultRoot, narratorOutput.time_passed);
    }
    const finalProse = illustratorOutput.prose_with_embeds;
    await appendJournal(input.vaultRoot, turnId, finalProse);

    const [npcFiles2, locFiles2] = await Promise.all([
      fs.readdir(npcsDir(input.vaultRoot)).catch(() => [] as string[]),
      fs.readdir(locationsDir(input.vaultRoot)).catch(() => [] as string[]),
    ]);
    const registry: AliasRegistry = {
      npcs: new Set(npcFiles2.filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3))),
      locations: new Set(locFiles2.filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3))),
      factions: new Set(Object.keys(loaded.factions)),
    };
    const stubReport = await stubOnMention(input.vaultRoot, registry, finalProse, turnId);
    await appendPlaytest(
      input.vaultRoot,
      turnId,
      renderPlaytest({
        turnId,
        decisions,
        narratorOutput,
        illustratorOutput,
        audioPath: audioPathResolved,
        matured,
        stubReport,
      }),
    );
    deps.emit({
      type: 'done',
      audioPath: audioPathResolved,
      finalProse,
      images: illustratorOutput.images,
    });
    return {
      status: 'success',
      turnId,
      finalProse,
      audioPath: audioPathResolved,
      images: illustratorOutput.images,
      matured,
    };
  } catch (err) {
    let message: string;
    let recoverable: boolean;
    if (isTaggedError(err, NARRATOR_FAILED)) {
      message = 'narrator failed; please rephrase';
      recoverable = true;
    } else if (isTaggedError(err, TTS_FAILED)) {
      message = 'audio render failed';
      recoverable = true;
    } else if (err instanceof Error) {
      message = `vault write failed: ${err.message}`;
      recoverable = false;
    } else {
      message = 'unknown error';
      recoverable = false;
    }
    deps.emit({ type: 'error', message, recoverable });
    return { status: 'error', message, recoverable };
  } finally {
    if (held) releaseMutex(slug);
  }
}

// ---- Mastra workflow shell (Studio observability) ------------------------

const inputSchema = z.object({
  vaultRoot: z.string().min(1),
  playerInput: z.string().min(1),
});
const outputSchema = z.object({
  turnId: z.string(),
  finalProse: z.string(),
  audioPath: z.string(),
  imageCount: z.number().int().nonnegative(),
});

const turnStep = createStep({
  id: 'turn',
  inputSchema,
  outputSchema,
  execute: async ({ inputData, mastra, writer }) => {
    if (!mastra) throw new Error('turnStep: mastra runtime not available');
    const narratorAgent = mastra.getAgent('narratorAgent') as unknown as AgentLike<NarratorOutput>;
    const factionAgent = mastra.getAgent('factionAgent') as unknown as AgentLike<FactionOutput>;
    const illustratorAgent = mastra.getAgent(
      'illustratorAgent',
    ) as unknown as AgentLike<IllustratorOutput>;
    const result = await runTurn(inputData, {
      narratorAgent,
      factionAgent,
      illustratorAgent,
      ttsRender: (text, opts) => ttsRender(text, { output: opts.output, voice: opts.voice }),
      emit: (e) => {
        // Mastra's writer is optional; swallow lock errors so a dropped SSE
        // consumer never crashes the workflow (concurrency invariant §3).
        writer?.write(e).catch(() => {});
      },
    });
    if (result.status === 'error') {
      throw new Error(`turn failed: ${result.message}`);
    }
    return {
      turnId: result.turnId,
      finalProse: result.finalProse,
      audioPath: result.audioPath,
      imageCount: result.images.length,
    };
  },
});

export const turnWorkflow = createWorkflow({
  id: 'turnWorkflow',
  inputSchema,
  outputSchema,
})
  .then(turnStep)
  .commit();
