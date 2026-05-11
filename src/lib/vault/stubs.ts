import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Kind } from './wikilinks';
import { npcsDir, factionsDir, locationsDir } from './paths';

// Sentence split: end-of-sentence punctuation, then whitespace, then a
// sentence-opener (capital ASCII letter, " or [, underscore for italics,
// or a Latin-1 capital). Mirrors OpenClaw `_SENT_SPLIT` verbatim — including
// the underscore so a sentence beginning with `_italic_ run-on` still splits.
// Imperfect — `Mr. Smith` and similar will split mid-sentence — but the
// spec's "best-effort but safe" applies.
const SENT_SPLIT = /(?<=[.!?])\s+(?=["[_A-ZÀ-Ý])/;

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
