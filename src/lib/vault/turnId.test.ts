import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { mintTurnId } from './turnId';

async function tmpRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'rpg-vault-turnid-'));
}

describe('mintTurnId', () => {
  it('creates .turn-counter with 1 when no file exists, returns turn-001', async () => {
    const root = await tmpRoot();
    try {
      const id = await mintTurnId(root);
      expect(id).toBe('turn-001');
      const raw = await fs.readFile(path.join(root, '.turn-counter'), 'utf8');
      expect(raw.trim()).toBe('1');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('increments monotonically across calls', async () => {
    const root = await tmpRoot();
    try {
      expect(await mintTurnId(root)).toBe('turn-001');
      expect(await mintTurnId(root)).toBe('turn-002');
      expect(await mintTurnId(root)).toBe('turn-003');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('pads to 3 digits at small numbers and keeps growing past 999', async () => {
    const root = await tmpRoot();
    try {
      await fs.writeFile(path.join(root, '.turn-counter'), '9\n');
      expect(await mintTurnId(root)).toBe('turn-010');
      await fs.writeFile(path.join(root, '.turn-counter'), '999\n');
      expect(await mintTurnId(root)).toBe('turn-1000');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('tolerates a gap (counter advanced externally)', async () => {
    const root = await tmpRoot();
    try {
      await fs.writeFile(path.join(root, '.turn-counter'), '42\n');
      expect(await mintTurnId(root)).toBe('turn-043');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('treats malformed counter content as 0 (next call returns turn-001)', async () => {
    const root = await tmpRoot();
    try {
      await fs.writeFile(path.join(root, '.turn-counter'), 'not a number\n');
      expect(await mintTurnId(root)).toBe('turn-001');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('writes atomically (no leftover .tmp on success)', async () => {
    const root = await tmpRoot();
    try {
      await mintTurnId(root);
      const entries = await fs.readdir(root);
      expect(entries.filter((e) => e.endsWith('.tmp'))).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('does not leak a .tmp file when the write fails', async () => {
    const root = await tmpRoot();
    const counterPath = path.join(root, '.turn-counter');
    const tmpPath = `${counterPath}.tmp`;
    // Force writeFile to fail by pre-creating the .tmp path as a directory.
    // writeFile rejects with EISDIR. Our atomic helper's catch block then
    // attempts to unlink, which also fails (EPERM on a non-empty dir / EISDIR
    // on macOS). The helper must swallow that unlink failure and re-throw
    // the original EISDIR. The user-visible invariant is: mintTurnId rejects,
    // and no NEW .tmp file (i.e., a regular-file .tmp) is left behind.
    await fs.mkdir(tmpPath);
    try {
      await expect(mintTurnId(root)).rejects.toMatchObject({ code: 'EISDIR' });
      // The .tmp path is still a directory (we can't unlink a non-empty dir
      // via fs.unlink), but importantly mintTurnId surfaced the writeFile
      // error rather than the unlink error — proving our catch swallowed.
      const stat = await fs.stat(tmpPath);
      expect(stat.isDirectory()).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
