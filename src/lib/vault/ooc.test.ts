import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { appendOoc, oocPath } from './ooc';

async function tmpVault(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'rpg-vault-ooc-'));
}

const FIXED_NOW = () => new Date('2026-05-16T18:00:00Z');

describe('appendOoc', () => {
  it('creates ooc.md with a `# OOC` header and a stamped entry on first append', async () => {
    const root = await tmpVault();
    try {
      await appendOoc(root, 'where are we?', 'You are in the harbor.', { now: FIXED_NOW });
      const raw = await fs.readFile(oocPath(root), 'utf8');
      expect(raw.startsWith('# OOC\n')).toBe(true);
      expect(raw).toContain('## 2026-05-16T18:00:00.000Z');
      expect(raw).toContain('**Q:** where are we?');
      expect(raw).toContain('**A:** You are in the harbor.');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('appends to an existing ooc.md without truncating prior entries', async () => {
    const root = await tmpVault();
    try {
      await appendOoc(root, 'first?', 'first answer', { now: FIXED_NOW });
      await appendOoc(root, 'second?', 'second answer', {
        now: () => new Date('2026-05-16T18:05:00Z'),
      });
      const raw = await fs.readFile(oocPath(root), 'utf8');
      expect(raw).toContain('**Q:** first?');
      expect(raw).toContain('**A:** first answer');
      expect(raw).toContain('**Q:** second?');
      expect(raw).toContain('**A:** second answer');
      expect(raw).toContain('## 2026-05-16T18:00:00.000Z');
      expect(raw).toContain('## 2026-05-16T18:05:00.000Z');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('is a no-op when either question or answer is empty', async () => {
    const root = await tmpVault();
    try {
      await appendOoc(root, '', 'answer', { now: FIXED_NOW });
      await appendOoc(root, 'question', '   ', { now: FIXED_NOW });
      await expect(fs.access(oocPath(root))).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('trims whitespace around Q and A to avoid duplicate blank lines', async () => {
    const root = await tmpVault();
    try {
      await appendOoc(root, '  what?  ', '  hello.  ', { now: FIXED_NOW });
      const raw = await fs.readFile(oocPath(root), 'utf8');
      expect(raw).toContain('**Q:** what?');
      expect(raw).toContain('**A:** hello.');
      expect(raw).not.toContain('**Q:**   what?');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
