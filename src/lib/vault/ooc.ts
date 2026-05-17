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
 *
 * Concurrency: OOC turns run WITHOUT the vault mutex (canonical turns hold it
 * for the duration of `runTurn`). Two concurrent OOC questions in the same
 * slug could race on a read-then-write append, so this uses `fs.appendFile`
 * which is atomic at the OS level (O_APPEND). Each entry starts with a
 * leading newline so consecutive appends remain readable.
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
  const block = `\n## ${stamp}\n\n**Q:** ${q}\n\n**A:** ${a}\n`;

  await fs.appendFile(oocPath(root), block, 'utf8');
}
