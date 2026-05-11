import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Mint the next turn id for the given vault root. Reads `<root>/.turn-counter`,
 * increments, writes back atomically, and returns `turn-NNN` (zero-padded to
 * 3 digits; grows beyond that as needed for n > 999). Missing or malformed
 * counter contents reset to 0 → returned id is `turn-001`.
 *
 * Atomic-write pattern: write to `<path>.tmp`, then `rename` over `<path>`.
 * `fs.rename` is atomic on POSIX, which is the only platform v0 targets.
 */
export async function mintTurnId(root: string): Promise<string> {
  const counterPath = path.join(root, '.turn-counter');
  let n = 0;
  try {
    const raw = await fs.readFile(counterPath, 'utf8');
    const parsed = Number.parseInt(raw.trim() || '0', 10);
    if (Number.isFinite(parsed) && parsed >= 0) n = parsed;
  } catch (err) {
    // ENOENT is fine — first turn for this vault. Anything else, also fine —
    // we treat a malformed/unreadable counter as 0 per spec "tolerates gaps".
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Swallow; the OpenClaw reference does the same (ValueError → 0).
    }
  }
  n += 1;
  await atomicWriteText(counterPath, `${n}\n`);
  return `turn-${String(n).padStart(3, '0')}`;
}

async function atomicWriteText(filePath: string, data: string): Promise<void> {
  const tmp = `${filePath}.tmp`;
  try {
    await fs.writeFile(tmp, data, 'utf8');
  } catch (err) {
    // If the tmp file materialised before the failure, scrub it so we don't
    // leak partial state on disk. unlink errors are intentionally swallowed
    // (ENOENT is the common path; we only care that the .tmp is gone).
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
  await fs.rename(tmp, filePath);
}
