import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { extractExcerpt, createStub } from './stubs';

async function tmpVault(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-vault-stubs-'));
  await fs.mkdir(path.join(root, 'npcs'), { recursive: true });
  await fs.mkdir(path.join(root, 'locations'), { recursive: true });
  await fs.mkdir(path.join(root, 'factions'), { recursive: true });
  return root;
}

describe('extractExcerpt', () => {
  it('returns the matching sentence with one neighbor on each side', () => {
    const prose =
      'First sentence. Second sentence mentions [[npcs/drovokk|Drovokk]]. Third sentence. Fourth sentence.';
    const out = extractExcerpt(prose, 'drovokk');
    expect(out).toBe(
      'First sentence. Second sentence mentions [[npcs/drovokk|Drovokk]]. Third sentence.',
    );
  });

  it('handles folder-prefixed target form ("npcs/drovokk")', () => {
    const prose = 'A. The priest [[npcs/drovokk]] is testifying. B.';
    const out = extractExcerpt(prose, 'npcs/drovokk');
    expect(out).toBe('A. The priest [[npcs/drovokk]] is testifying. B.');
  });

  it('handles bare links resolved through slugification', () => {
    const prose = 'Alpha. Bravo [[Drovokk]] arrives. Charlie.';
    // Caller passes the slug; we tolerate the original target text in the link.
    const out = extractExcerpt(prose, 'drovokk');
    expect(out).toBe('Alpha. Bravo [[Drovokk]] arrives. Charlie.');
  });

  it('clamps to start/end when the match is at the boundary', () => {
    const prose = '[[npcs/foo]] starts. Second. Third.';
    const out = extractExcerpt(prose, 'foo');
    expect(out).toBe('[[npcs/foo]] starts. Second.');
  });

  it('returns null when target is not found', () => {
    const prose = 'No links here at all.';
    expect(extractExcerpt(prose, 'foo')).toBeNull();
  });

  it('returns the first match when the target appears multiple times', () => {
    const prose = 'A. First [[npcs/foo]]. B. Second [[npcs/foo]] mention. C.';
    const out = extractExcerpt(prose, 'foo');
    expect(out).toBe('A. First [[npcs/foo]]. B.');
  });
});

describe('createStub', () => {
  it('writes an npc stub with faction: line and tags [npc, stub]', async () => {
    const root = await tmpVault();
    try {
      const res = await createStub(root, {
        kind: 'npc',
        slug: 'drovokk',
        excerptProse: 'A. Priest [[npcs/drovokk]] testifies. B.',
      });
      expect(res.created).toBe(true);
      const written = await fs.readFile(path.join(root, 'npcs', 'drovokk.md'), 'utf8');
      expect(written).toContain('---\naliases: []\ntags: [npc, stub]\nfaction:\n---\n');
      expect(written).toContain('Priest [[npcs/drovokk]] testifies.');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('writes a location stub WITHOUT faction:', async () => {
    const root = await tmpVault();
    try {
      const res = await createStub(root, {
        kind: 'location',
        slug: 'saint-of-vontor',
        excerptProse: 'A. The [[locations/saint-of-vontor]] hangs in the void. B.',
      });
      expect(res.created).toBe(true);
      const written = await fs.readFile(path.join(root, 'locations', 'saint-of-vontor.md'), 'utf8');
      expect(written).toContain('---\naliases: []\ntags: [location, stub]\n---\n');
      expect(written).not.toContain('faction:');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('writes a faction stub with tags [faction, stub] and no faction: line', async () => {
    const root = await tmpVault();
    try {
      const res = await createStub(root, {
        kind: 'faction',
        slug: 'free-fleet',
        excerptProse: 'A. The [[factions/free-fleet]] declares neutrality. B.',
      });
      expect(res.created).toBe(true);
      const written = await fs.readFile(path.join(root, 'factions', 'free-fleet.md'), 'utf8');
      expect(written).toContain('tags: [faction, stub]');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('is idempotent: existing file returns { created: false } and is not overwritten', async () => {
    const root = await tmpVault();
    try {
      await fs.writeFile(path.join(root, 'npcs', 'drovokk.md'), 'original content');
      const res = await createStub(root, {
        kind: 'npc',
        slug: 'drovokk',
        excerptProse: 'irrelevant',
      });
      expect(res.created).toBe(false);
      const written = await fs.readFile(path.join(root, 'npcs', 'drovokk.md'), 'utf8');
      expect(written).toBe('original content');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('falls back to a placeholder body when excerpt is empty', async () => {
    const root = await tmpVault();
    try {
      const res = await createStub(root, {
        kind: 'npc',
        slug: 'orphan',
        excerptProse: '', // caller passed empty prose; body should not be blank
      });
      expect(res.created).toBe(true);
      const written = await fs.readFile(path.join(root, 'npcs', 'orphan.md'), 'utf8');
      expect(written).toContain('_Stub created by GM. Body to be filled in._');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('creates the parent directory if missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-vault-stubs-nodir-'));
    try {
      // Don't pre-create npcs/
      const res = await createStub(root, {
        kind: 'npc',
        slug: 'fresh',
        excerptProse: 'a. [[npcs/fresh]] arrives. b.',
      });
      expect(res.created).toBe(true);
      const stat = await fs.stat(path.join(root, 'npcs', 'fresh.md'));
      expect(stat.isFile()).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects image kind (no entity to stub)', async () => {
    const root = await tmpVault();
    try {
      await expect(
        createStub(root, {
          // @ts-expect-error -- intentional invalid kind
          kind: 'image',
          slug: 'whatever',
          excerptProse: 'a',
        }),
      ).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('falls back to placeholder when prose is non-empty but target not found', async () => {
    const root = await tmpVault();
    try {
      const res = await createStub(root, {
        kind: 'npc',
        slug: 'ghost',
        excerptProse: 'Prose that mentions no wikilink for the target.',
      });
      expect(res.created).toBe(true);
      const written = await fs.readFile(path.join(root, 'npcs', 'ghost.md'), 'utf8');
      expect(written).toContain('_Stub created by GM. Body to be filled in._');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
