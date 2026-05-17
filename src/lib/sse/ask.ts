// src/lib/sse/ask.ts
//
// The OOC fork. When the classifier decides a player message is a meta
// question (not a canonical turn), the route calls `runAsk` instead of
// `runTurn`. The loremaster agent streams a plain-prose answer; no media,
// no journal, no playtest, no stubs, no worldTick. The exchange is written
// to `<root>/ooc.md` only — a write-only debug log never read by any agent.
//
// The mutex is NOT held: OOC is read-only against canonical vault state, so
// it can run concurrently with a canonical turn without corrupting it.

import type { PhaseEvent } from './events';
import type { AgentLike, PhaseEventEmitter } from '@/mastra/workflows/turn';
import { vaultRoot } from '@/lib/vault/paths';
import { appendOoc } from '@/lib/vault/ooc';
import { loadAlwaysLoaded } from '@/lib/vault/entities';
import { parseRecentEntries, type JournalEntry } from '@/lib/vault/journal';
import { buildLoremasterDossier } from '@/lib/dossier';

export interface RunAskInput {
  slug: string;
  input: string;
}

export type Emit = (ev: PhaseEvent) => void;

export interface MockAskOpts {
  /** ms between mock events. 0 disables timers. Default: 250. */
  delayMs?: number;
}

export interface RunAskDeps {
  /** Loremaster agent. Stream-only; no structured output. */
  loremasterAgent: AgentLike<unknown>;
  /** Vault root override (test seam). Defaults to `vaultRoot(input.slug)`. */
  vaultRoot?: (slug: string) => string;
  /** Persist hook. Defaults to `appendOoc`. Tests inject a spy. */
  appendOoc?: (root: string, question: string, answer: string) => Promise<void>;
  emit: PhaseEventEmitter;
}

// ----- mock implementation ------------------------------------------------

const MOCK_ASK_DELTAS = [
  'You are in the harbor district. ',
  'Kessha was last seen on the pier; the manifest is still with you.',
];

export async function mockRunAsk(
  input: RunAskInput,
  emit: Emit,
  opts: MockAskOpts = {},
): Promise<void> {
  void input;
  const delay = opts.delayMs ?? 250;
  const sleep = (ms: number) =>
    ms === 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

  emit({ type: 'phase', name: 'ask' });
  await sleep(delay);

  for (const d of MOCK_ASK_DELTAS) {
    emit({ type: 'prose_delta', text: d });
    await sleep(delay);
  }

  const finalProse = MOCK_ASK_DELTAS.join('');
  emit({
    type: 'done',
    audioPath: null,
    finalProse,
    images: [],
    mode: 'ooc',
  });
}

// ----- live implementation ------------------------------------------------

/**
 * Run an OOC question through the loremaster.
 *
 * Phases: `ask` → streamed `prose_delta`s → `done` (mode: 'ooc', audioPath: null).
 * After the stream completes, the question + answer is appended to
 * `<root>/ooc.md` (write-only, never read).
 */
export async function runAsk(input: RunAskInput, deps: RunAskDeps): Promise<void> {
  const rootFn = deps.vaultRoot ?? vaultRoot;
  const root = rootFn(input.slug);
  const appender = deps.appendOoc ?? appendOoc;

  deps.emit({ type: 'phase', name: 'ask' });

  // Load context — same shape the narrator gets, minus per-turn fan-out.
  let loaded: Awaited<ReturnType<typeof loadAlwaysLoaded>>;
  let recent: JournalEntry[];
  try {
    [loaded, recent] = await Promise.all([loadAlwaysLoaded(root), parseRecentEntries(root, 5)]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.emit({ type: 'error', message: `vault read failed: ${message}`, recoverable: false });
    return;
  }

  const dossier = buildLoremasterDossier({
    world: loaded.world,
    character: loaded.character,
    threads: loaded.threads,
    factions: Object.values(loaded.factions),
    recent,
    playerInput: input.input,
  });

  let finalProse = '';
  try {
    const stream = await deps.loremasterAgent.stream(dossier);
    for await (const chunk of stream.textStream) {
      if (chunk.length > 0) {
        finalProse += chunk;
        deps.emit({ type: 'prose_delta', text: chunk });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.emit({ type: 'error', message: `loremaster failed: ${message}`, recoverable: true });
    return;
  }

  deps.emit({
    type: 'done',
    audioPath: null,
    finalProse,
    images: [],
    mode: 'ooc',
  });

  // Best-effort persist. A failure here must not surface as a stream error
  // because the player already saw the answer; surface in server logs only.
  try {
    await appender(root, input.input, finalProse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[runAsk] appendOoc failed for slug=${input.slug}: ${message}`);
  }
}
