import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { worldTick } from './threads';

const FIXTURE = 'tests/fixtures/test-vault';

async function tmpVaultWithThreads(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-vault-threads-'));
  await fs.copyFile(path.join(FIXTURE, 'threads.xml'), path.join(root, 'threads.xml'));
  return root;
}

describe('worldTick', () => {
  it('advances every non-matured clock by 1 day', async () => {
    const root = await tmpVaultWithThreads();
    try {
      const matured = await worldTick(root, { days: 1 });
      const text = await fs.readFile(path.join(root, 'threads.xml'), 'utf8');
      // fresh: 1/8 → 2/8; mid: 4/7 → 5/7; matured-clock was 5/5 → still 5/5 (clamped)
      expect(text).toContain('<progress>2/8</progress>');
      expect(text).toContain('<progress>5/7</progress>');
      expect(text).toContain('<progress>5/5</progress>');
      // The pre-matured 5/5 thread does NOT show up — it was already at total.
      expect(matured).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('returns matured threads that CROSS into cur === total during this tick', async () => {
    const root = await tmpVaultWithThreads();
    try {
      // mid-clock is at 4/7; tick by 3 days → 7/7 (newly matured).
      const matured = await worldTick(root, { days: 3 });
      expect(matured.map((t) => t.id).sort()).toEqual(['mid-clock']);
      expect(matured[0].name).toBe('Mid Clock');
      expect(matured[0].stake).toContain('midpoint');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('caps at total (does not overshoot)', async () => {
    const root = await tmpVaultWithThreads();
    try {
      // fresh-clock is 1/8; tick by 99 → 8/8 (capped, newly matured).
      const matured = await worldTick(root, { days: 99 });
      const text = await fs.readFile(path.join(root, 'threads.xml'), 'utf8');
      expect(text).toContain('<progress>8/8</progress>');
      expect(text).toContain('<progress>7/7</progress>');
      expect(matured.map((t) => t.id).sort()).toEqual(['fresh-clock', 'mid-clock']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('uses hours fallback: 48h → 2 days; 23h → 0 days (floor)', async () => {
    const root = await tmpVaultWithThreads();
    try {
      const matured = await worldTick(root, { hours: 23 });
      const text = await fs.readFile(path.join(root, 'threads.xml'), 'utf8');
      // 23h floors to 0 days; nothing advances.
      expect(text).toContain('<progress>1/8</progress>');
      expect(matured).toEqual([]);

      await worldTick(root, { hours: 48 });
      const text2 = await fs.readFile(path.join(root, 'threads.xml'), 'utf8');
      // 48h floors to 2 days; fresh 1/8 → 3/8, mid 4/7 → 6/7.
      expect(text2).toContain('<progress>3/8</progress>');
      expect(text2).toContain('<progress>6/7</progress>');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('returns [] for a zero or negative tick (no-op)', async () => {
    const root = await tmpVaultWithThreads();
    try {
      expect(await worldTick(root, { days: 0 })).toEqual([]);
      expect(await worldTick(root, { days: -3 })).toEqual([]);
      // File unchanged.
      const text = await fs.readFile(path.join(root, 'threads.xml'), 'utf8');
      expect(text).toContain('<progress>1/8</progress>');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('preserves whitespace and non-progress content byte-for-byte (except <progress>)', async () => {
    const root = await tmpVaultWithThreads();
    try {
      const before = await fs.readFile(path.join(root, 'threads.xml'), 'utf8');
      await worldTick(root, { days: 1 });
      const after = await fs.readFile(path.join(root, 'threads.xml'), 'utf8');
      // Compute the diff by removing only the <progress>...</progress> bodies.
      const stripProg = (s: string) =>
        s.replace(/<progress>[^<]*<\/progress>/g, '<progress>X</progress>');
      expect(stripProg(after)).toBe(stripProg(before));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('throws when threads.xml is missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-vault-threads-missing-'));
    try {
      await expect(worldTick(root, { days: 1 })).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('defaults to 1 day when no field is provided', async () => {
    const root = await tmpVaultWithThreads();
    try {
      await worldTick(root, {});
      const text = await fs.readFile(path.join(root, 'threads.xml'), 'utf8');
      expect(text).toContain('<progress>2/8</progress>');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('leaves malformed <progress> contents unchanged and does not mature them', async () => {
    // Replace the fresh-clock progress with non-numeric content; ensure we
    // don't crash, don't mutate the bad block, and don't report it as matured.
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-vault-threads-malformed-'));
    try {
      const raw = `<threads>
  <thread id="bad-clock">
    <name>Bad Clock</name>
    <stake>Malformed progress.</stake>
    <progress>not-a-number/x</progress>
    <trigger>n/a</trigger>
  </thread>
  <thread id="ok-clock">
    <name>Ok Clock</name>
    <stake>Normal.</stake>
    <progress>1/3</progress>
    <trigger>n/a</trigger>
  </thread>
</threads>
`;
      await fs.writeFile(path.join(root, 'threads.xml'), raw, 'utf8');
      const matured = await worldTick(root, { days: 1 });
      const after = await fs.readFile(path.join(root, 'threads.xml'), 'utf8');
      // Bad block preserved verbatim; ok block advanced.
      expect(after).toContain('<progress>not-a-number/x</progress>');
      expect(after).toContain('<progress>2/3</progress>');
      // bad-clock never appears in matured; ok-clock didn't cross to total either.
      expect(matured).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
