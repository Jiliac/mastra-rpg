import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { appendPlaytest } from './playtests';

async function tmpVault(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'rpg-vault-playtests-'));
}

describe('appendPlaytest', () => {
  it('creates playtests/<date>.md if missing and writes a turn block', async () => {
    const root = await tmpVault();
    try {
      const written = await appendPlaytest(root, 'turn-001', 'first body', { today: '2026-05-11' });
      expect(written).toBe(path.join(root, 'playtests', '2026-05-11.md'));
      const text = await fs.readFile(written, 'utf8');
      expect(text).toBe('\n## turn-001\nfirst body\n');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('appends a second turn block without disturbing the first', async () => {
    const root = await tmpVault();
    try {
      await appendPlaytest(root, 'turn-001', 'first body', { today: '2026-05-11' });
      await appendPlaytest(root, 'turn-002', 'second body', { today: '2026-05-11' });
      const text = await fs.readFile(path.join(root, 'playtests', '2026-05-11.md'), 'utf8');
      expect(text).toBe('\n## turn-001\nfirst body\n\n## turn-002\nsecond body\n');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('creates the playtests/ parent directory if missing', async () => {
    const root = await tmpVault();
    try {
      await appendPlaytest(root, 'turn-003', 'body', { today: '2026-05-12' });
      const stat = await fs.stat(path.join(root, 'playtests'));
      expect(stat.isDirectory()).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rotates filenames on a new ISO date', async () => {
    const root = await tmpVault();
    try {
      await appendPlaytest(root, 'turn-100', 'monday body', { today: '2026-05-11' });
      await appendPlaytest(root, 'turn-101', 'tuesday body', { today: '2026-05-12' });
      const mon = await fs.readFile(path.join(root, 'playtests', '2026-05-11.md'), 'utf8');
      const tue = await fs.readFile(path.join(root, 'playtests', '2026-05-12.md'), 'utf8');
      expect(mon).toContain('turn-100');
      expect(mon).not.toContain('turn-101');
      expect(tue).toContain('turn-101');
      expect(tue).not.toContain('turn-100');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('strips trailing whitespace from body before appending', async () => {
    const root = await tmpVault();
    try {
      const written = await appendPlaytest(root, 'turn-007', 'body with trailing\n\n\n', {
        today: '2026-05-11',
      });
      const text = await fs.readFile(written, 'utf8');
      expect(text).toBe('\n## turn-007\nbody with trailing\n');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('defaults to system today when `today` is not provided', async () => {
    const root = await tmpVault();
    try {
      const written = await appendPlaytest(root, 'turn-008', 'b');
      const today = new Date().toISOString().slice(0, 10);
      expect(written).toBe(path.join(root, 'playtests', `${today}.md`));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
