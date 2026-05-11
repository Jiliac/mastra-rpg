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
