import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { loadEntityTool, loadEntityImpl } from './loadEntity';

const FIXTURE_ROOT = path.resolve(__dirname, '../../../tests/fixtures/test-vault');

describe('loadEntityImpl', () => {
  it('loads an existing NPC and returns frontmatter + body', async () => {
    const res = await loadEntityImpl({ kind: 'npc', slug: 'kessha' }, { vaultRoot: FIXTURE_ROOT });
    expect(res.found).toBe(true);
    if (!res.found) throw new Error('unreachable');
    expect(res.slug).toBe('kessha');
    expect(res.kind).toBe('npc');
    expect(typeof res.body).toBe('string');
    expect(res.body.length).toBeGreaterThan(0);
    // Kessha has faction: red-banner per the fixture.
    expect(res.frontmatter.faction).toBe('red-banner');
  });

  it('loads an existing faction', async () => {
    const res = await loadEntityImpl(
      { kind: 'faction', slug: 'red-banner' },
      { vaultRoot: FIXTURE_ROOT },
    );
    expect(res.found).toBe(true);
  });

  it('loads an existing location', async () => {
    const res = await loadEntityImpl(
      { kind: 'location', slug: 'iron-promise' },
      { vaultRoot: FIXTURE_ROOT },
    );
    expect(res.found).toBe(true);
  });

  it('returns { found: false } for a missing slug (ENOENT)', async () => {
    const res = await loadEntityImpl(
      { kind: 'npc', slug: 'does-not-exist' },
      { vaultRoot: FIXTURE_ROOT },
    );
    expect(res.found).toBe(false);
    if (res.found) throw new Error('unreachable');
    expect(res.kind).toBe('npc');
    expect(res.slug).toBe('does-not-exist');
    expect(res.error).toMatch(/ENOENT|no such file/i);
  });

  it('rethrows non-ENOENT loader errors (e.g. malformed entity) instead of masking as not-found', async () => {
    // The Wave-1 loaders throw with ENOENT on a missing file, but they ALSO
    // throw on malformed YAML or missing frontmatter. We must let those bubble
    // up so real bugs don't hide behind a misleading `{ found: false }`.
    // Inject a loader override via the deps seam; the tool should rethrow.
    const badLoader = async () => {
      const err: NodeJS.ErrnoException = new Error('malformed yaml');
      err.code = 'EBADF';
      throw err;
    };
    await expect(
      loadEntityImpl(
        { kind: 'npc', slug: 'malformed' },
        { vaultRoot: FIXTURE_ROOT, loaders: { npc: badLoader } },
      ),
    ).rejects.toThrow(/malformed yaml/);
  });
});

describe('loadEntityTool', () => {
  it('exposes id "loadEntity" with the documented input schema', () => {
    expect(loadEntityTool.id).toBe('loadEntity');
    expect(loadEntityTool.inputSchema).toBeDefined();
  });
});
