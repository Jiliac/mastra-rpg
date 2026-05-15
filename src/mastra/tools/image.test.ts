import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { imageTool, imageImpl } from './image';

async function tmpVault(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'rpg-image-tool-'));
}

describe('imageImpl', () => {
  // vi.stubEnv mutations are reverted automatically by vi.unstubAllEnvs, so the
  // missing-env test below cannot leak its mutation into other parallel tests.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('delegates to generateImage with prompt + slug + resolved vaultRoot and returns ImageMeta', async () => {
    const vaultRoot = await tmpVault();
    const fakeMeta = {
      filename: '20260511-140000-kessha-abc123.png',
      path: path.join(vaultRoot, 'images', '20260511-140000-kessha-abc123.png'),
      prompt: 'Kessha at the helm',
      slug: 'kessha',
    };
    const generate = vi.fn().mockResolvedValue(fakeMeta);
    const res = await imageImpl(
      { prompt: 'Kessha at the helm', slug: 'kessha' },
      { vaultRoot, generateImage: generate },
    );
    expect(res).toEqual(fakeMeta);
    expect(generate).toHaveBeenCalledTimes(1);
    const args = generate.mock.calls[0][0];
    expect(args.prompt).toBe('Kessha at the helm');
    expect(args.slug).toBe('kessha');
    expect(args.vaultRoot).toBe(vaultRoot);
  });

  it('throws if VAULT_SLUG is unset and no deps.vaultRoot is provided', async () => {
    const generate = vi.fn();
    // stubEnv records the original value and is restored by unstubAllEnvs in
    // afterEach — safer than direct process.env mutation across parallel tests.
    vi.stubEnv('VAULT_SLUG', '');
    await expect(
      imageImpl({ prompt: 'p', slug: 's' }, { generateImage: generate }),
    ).rejects.toThrow(/VAULT_SLUG/);
  });
});

describe('imageTool', () => {
  it('exposes id "image" with prompt + slug inputs', () => {
    expect(imageTool.id).toBe('image');
    expect(imageTool.inputSchema).toBeDefined();
  });
});
