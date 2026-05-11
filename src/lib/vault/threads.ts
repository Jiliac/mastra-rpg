import * as fs from 'node:fs/promises';
import { threadsXmlPath } from './paths';

export interface MaturedThread {
  id: string;
  name: string;
  stake: string;
}

export interface TickInput {
  /** Whole days to advance. Takes precedence over hours. Default: 1. */
  days?: number;
  /** Hours; floored to whole days. Ignored if `days` is provided. */
  hours?: number;
}

// Match a <thread id="..."> ... </thread> block, with the id pulled out.
const THREAD_RE = /<thread\b([^>]*)>([\s\S]*?)<\/thread>/g;
const ID_RE = /\bid="([^"]+)"/;
const NAME_RE = /<name>([^<]*)<\/name>/;
const STAKE_RE = /<stake>([\s\S]*?)<\/stake>/;
const PROGRESS_RE = /<progress>\s*(\d+)\s*\/\s*(\d+)\s*<\/progress>/;

/**
 * Advance every clock in `<root>/threads.xml` by `delta` (days; or hours
 * floored to days), clamped at each thread's total. Returns the list of
 * threads that CROSSED INTO cur === total during this tick (pre-matured
 * threads are not re-reported).
 *
 * Writes back via atomic tmp+rename. Whitespace and non-progress content
 * preserved byte-for-byte. Mirrors OpenClaw `cmd_world_tick`.
 */
export async function worldTick(root: string, input: TickInput): Promise<MaturedThread[]> {
  const delta = computeDelta(input);
  const filePath = threadsXmlPath(root);
  if (delta <= 0) {
    // Touch the file to confirm it exists (so a missing-file test still throws
    // before returning the no-op result). Cheap stat — no read.
    await fs.stat(filePath);
    return [];
  }

  const raw = await fs.readFile(filePath, 'utf8');
  const matured: MaturedThread[] = [];

  const next = raw.replace(THREAD_RE, (whole, openAttrs: string, body: string) => {
    const idMatch = openAttrs.match(ID_RE);
    const id = idMatch ? idMatch[1] : '';
    const progMatch = body.match(PROGRESS_RE);
    if (!progMatch) return whole;
    const cur = Number.parseInt(progMatch[1], 10);
    const total = Number.parseInt(progMatch[2], 10);
    if (!Number.isFinite(cur) || !Number.isFinite(total) || cur >= total) return whole;

    const newCur = Math.min(cur + delta, total);
    const newProgress = `<progress>${newCur}/${total}</progress>`;
    const newBody =
      body.slice(0, progMatch.index!) +
      newProgress +
      body.slice(progMatch.index! + progMatch[0].length);

    if (newCur >= total) {
      const nameMatch = newBody.match(NAME_RE);
      const stakeMatch = newBody.match(STAKE_RE);
      matured.push({
        id,
        name: nameMatch ? nameMatch[1].trim() : '',
        stake: stakeMatch ? stakeMatch[1].trim().replace(/\s+/g, ' ') : '',
      });
    }

    return `<thread${openAttrs}>${newBody}</thread>`;
  });

  await atomicWriteText(filePath, next);
  return matured;
}

function computeDelta(input: TickInput): number {
  if (typeof input.days === 'number') return Math.max(0, Math.floor(input.days));
  if (typeof input.hours === 'number') return Math.max(0, Math.floor(input.hours / 24));
  return 1;
}

async function atomicWriteText(filePath: string, data: string): Promise<void> {
  const tmp = `${filePath}.tmp`;
  try {
    await fs.writeFile(tmp, data, 'utf8');
  } catch (err) {
    // Scrub any partial .tmp so we don't leak state on disk. unlink errors
    // are intentionally swallowed (ENOENT common path).
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
  await fs.rename(tmp, filePath);
}
