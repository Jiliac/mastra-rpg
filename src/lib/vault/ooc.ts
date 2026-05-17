import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export const oocPath = (root: string) => path.join(root, 'ooc.md');

export interface AppendOocOptions {
  /** Override the clock for deterministic tests. Defaults to `new Date()`. */
  now?: () => Date;
}

/**
 * Append a timestamped OOC exchange to `<root>/ooc.md`. Format mirrors
 * `appendJournal`'s timestamp+heading+body shape but uses real-world clock
 * (not in-game date) since this file lives outside the canonical fiction.
 *
 * One file per slug, append-only, never read by any agent. If `question` or
 * `answer` is empty after trimming, the call is a no-op so the file never
 * accumulates blank entries from edge cases.
 */
export async function appendOoc(
  root: string,
  question: string,
  answer: string,
  options: AppendOocOptions = {},
): Promise<void> {
  const q = question.trim();
  const a = answer.trim();
  if (q.length === 0 || a.length === 0) return;

  const now = options.now ? options.now() : new Date();
  const stamp = now.toISOString();
  const heading = `## ${stamp}`;
  const block = `\n\n${heading}\n\n**Q:** ${q}\n\n**A:** ${a}\n`;

  const filePath = oocPath(root);
  let existing: string | null = null;
  try {
    existing = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const next = existing === null ? `# OOC${block}` : `${existing.replace(/\s+$/, '')}${block}`;
  await fs.writeFile(filePath, next, 'utf8');
}
