import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseRecentEntries, appendJournal } from './journal';

const FIXTURE = 'tests/fixtures/test-vault';

async function tmpVault(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'rpg-vault-journal-'));
}

describe('parseRecentEntries', () => {
  it('returns the last n entries with heading + body preserved verbatim', async () => {
    const entries = await parseRecentEntries(FIXTURE, 2);
    expect(entries).toHaveLength(2);
    expect(entries[0].heading).toBe('7 ABY, Month 4, Standard Day 18 — turn-001');
    expect(entries[0].body).toContain('Turn-001 prose mentions');
    expect(entries[1].heading).toBe('Turn 002 - 7 ABY, Month 4, Day 19');
    expect(entries[1].body).toContain('Turn-002 prose mentions');
  });

  it('returns all entries when n exceeds total', async () => {
    const entries = await parseRecentEntries(FIXTURE, 99);
    expect(entries).toHaveLength(3);
  });

  it('treats the heading line as opaque text (handles format drift)', async () => {
    const entries = await parseRecentEntries(FIXTURE, 3);
    // Three different heading formats in the fixture; none should crash.
    expect(entries.map((e) => e.heading)).toEqual([
      '7 ABY, Month 4, Day 18 — Prologue',
      '7 ABY, Month 4, Standard Day 18 — turn-001',
      'Turn 002 - 7 ABY, Month 4, Day 19',
    ]);
  });

  it('returns [] when journal.md is missing', async () => {
    const root = await tmpVault();
    try {
      const entries = await parseRecentEntries(root, 5);
      expect(entries).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('clamps n to >= 1', async () => {
    const entries = await parseRecentEntries(FIXTURE, 0);
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });
});

describe('appendJournal', () => {
  // Each append test runs against a copy of the fixture so we don't trample
  // the original. We copy world.xml + journal.md only.
  async function freshVault(withJournal: boolean): Promise<string> {
    const root = await tmpVault();
    await fs.copyFile(path.join(FIXTURE, 'world.xml'), path.join(root, 'world.xml'));
    if (withJournal) {
      await fs.copyFile(path.join(FIXTURE, 'journal.md'), path.join(root, 'journal.md'));
    }
    return root;
  }

  it('appends a heading derived from world.xml date', async () => {
    const root = await freshVault(true);
    try {
      await appendJournal(root, 'turn-099', 'New prose body.');
      const journal = await fs.readFile(path.join(root, 'journal.md'), 'utf8');
      expect(journal).toContain('## 7 ABY, Month 4, Standard Day 20 — turn-099\n\nNew prose body.');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('creates journal.md with a # Journal header if missing', async () => {
    const root = await freshVault(false);
    try {
      await appendJournal(root, 'turn-001', 'First entry.');
      const journal = await fs.readFile(path.join(root, 'journal.md'), 'utf8');
      expect(journal.startsWith('# Journal\n')).toBe(true);
      expect(journal).toContain('## 7 ABY, Month 4, Standard Day 20 — turn-001\n\nFirst entry.');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('preserves existing entries (does not truncate)', async () => {
    const root = await freshVault(true);
    try {
      await appendJournal(root, 'turn-099', 'New prose body.');
      const journal = await fs.readFile(path.join(root, 'journal.md'), 'utf8');
      expect(journal).toContain('Prologue prose.');
      expect(journal).toContain('Turn-001 prose mentions');
      expect(journal).toContain('New prose body.');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('strips trailing whitespace from existing file before appending', async () => {
    const root = await freshVault(false);
    try {
      // Pre-seed journal with extra trailing whitespace.
      await fs.writeFile(path.join(root, 'journal.md'), '# Journal\n\n## Old\n\nOld body.\n\n\n\n');
      await appendJournal(root, 'turn-002', 'New body.');
      const journal = await fs.readFile(path.join(root, 'journal.md'), 'utf8');
      // Exactly one blank line between previous body and new heading.
      expect(journal).toMatch(/Old body\.\n\n## 7 ABY[^\n]+— turn-002\n\nNew body\.\n$/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('falls back to "## <turnId>" if world.xml lacks a date', async () => {
    const root = await tmpVault();
    try {
      // Minimal world.xml without a <date> element.
      await fs.writeFile(
        path.join(root, 'world.xml'),
        '<world><location><region>x</region></location></world>\n',
      );
      await appendJournal(root, 'turn-001', 'Body.');
      const journal = await fs.readFile(path.join(root, 'journal.md'), 'utf8');
      expect(journal).toContain('## turn-001\n\nBody.');
      expect(journal).not.toContain('— turn-001');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
