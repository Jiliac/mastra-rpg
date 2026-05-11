import * as fs from 'node:fs/promises';
import { journalPath } from './paths';
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
