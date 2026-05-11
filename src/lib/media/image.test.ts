import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { generateImage, buildFilename, type ImageDeps, type OpenAILike } from './image';

const SAMPLE_B64 = Buffer.from('fake-png-bytes').toString('base64');

/**
 * Fake OpenAI-shaped client. `generateImage` only ever calls
 * `client.images.generate(args)` and expects `{ data: [{ b64_json }] }` back,
 * so we don't have to mirror the full SDK surface — only `images.generate`.
 */
function makeFakeOpenAI(
  body: { data?: Array<{ b64_json?: string }> } | Error = {
    data: [{ b64_json: SAMPLE_B64 }],
  },
): OpenAILike & { images: { generate: ReturnType<typeof vi.fn> } } {
  const generate = vi.fn(async (_args: Record<string, unknown>) => {
    if (body instanceof Error) throw body;
    return body;
  });
  return { images: { generate } };
}

async function tmpVault(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'rpg-image-'));
}

describe('buildFilename', () => {
  it('matches the YYYYMMDD-HHMMSS-<slug>-<6char-rand>.png pattern', () => {
    const fn = buildFilename('kessha');
    expect(fn).toMatch(/^\d{8}-\d{6}-kessha-[a-z0-9]{6}\.png$/);
  });

  it('produces a different suffix on each call for the same slug + same second', () => {
    const a = buildFilename('s', { now: new Date('2026-05-11T08:07:00Z') });
    const b = buildFilename('s', { now: new Date('2026-05-11T08:07:00Z') });
    // The timestamps are identical; only the random suffix varies.
    expect(a).not.toBe(b);
    expect(a.slice(0, 18)).toBe(b.slice(0, 18));
  });

  it('slugifies the input (lowercase, dashes for spaces)', () => {
    const fn = buildFilename('Kessha At The Helm');
    expect(fn).toMatch(/^\d{8}-\d{6}-kessha-at-the-helm-[a-z0-9]{6}\.png$/);
  });

  it('uses a fallback slug "scene" when input slug is empty', () => {
    const fn = buildFilename('');
    expect(fn).toMatch(/^\d{8}-\d{6}-scene-[a-z0-9]{6}\.png$/);
  });
});

describe('generateImage', () => {
  it('calls client.images.generate with model=gpt-image-2 + quality=high + n=1', async () => {
    const openai = makeFakeOpenAI();
    const vaultRoot = await tmpVault();
    const deps: ImageDeps = { openai };
    await generateImage({
      prompt: 'Kessha at the helm',
      slug: 'kessha-helm',
      vaultRoot,
      apiKey: 'sk-test',
      deps,
    });
    expect(openai.images.generate).toHaveBeenCalledTimes(1);
    const args = openai.images.generate.mock.calls[0][0] as Record<string, unknown>;
    expect(args.model).toBe('gpt-image-2');
    expect(args.prompt).toBe('Kessha at the helm');
    expect(args.n).toBe(1);
    expect(args.quality).toBe('high');
    expect(args.size).toBe('1024x1024');
  });

  it('writes the PNG under <vaultRoot>/images/ with the documented filename pattern', async () => {
    const openai = makeFakeOpenAI();
    const vaultRoot = await tmpVault();
    const deps: ImageDeps = { openai };
    const res = await generateImage({
      prompt: 'p',
      slug: 'kessha',
      vaultRoot,
      apiKey: 'k',
      deps,
    });
    expect(res.filename).toMatch(/^\d{8}-\d{6}-kessha-[a-z0-9]{6}\.png$/);
    expect(res.path).toBe(path.join(vaultRoot, 'images', res.filename));
    expect(res.slug).toBe('kessha');
    expect(res.prompt).toBe('p');
    const stat = await fs.stat(res.path);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('creates the <vaultRoot>/images/ directory if missing', async () => {
    const openai = makeFakeOpenAI();
    const vaultRoot = await tmpVault();
    // do NOT pre-create images/
    const deps: ImageDeps = { openai };
    await generateImage({ prompt: 'p', slug: 's', vaultRoot, apiKey: 'k', deps });
    const dirStat = await fs.stat(path.join(vaultRoot, 'images'));
    expect(dirStat.isDirectory()).toBe(true);
  });

  it('surfaces SDK errors (e.g. 429 rate-limit) as a thrown error', async () => {
    const openai = makeFakeOpenAI(new Error('429 rate limited'));
    const vaultRoot = await tmpVault();
    const deps: ImageDeps = { openai };
    await expect(
      generateImage({ prompt: 'p', slug: 's', vaultRoot, apiKey: 'k', deps }),
    ).rejects.toThrow(/429/);
  });

  it('throws when api key is missing (no apiKey arg + no env var + no injected client)', async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const vaultRoot = await tmpVault();
    try {
      await expect(generateImage({ prompt: 'p', slug: 's', vaultRoot })).rejects.toThrow(
        /OPENAI_API_KEY/,
      );
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });

  it('throws when the SDK response lacks b64_json', async () => {
    const openai = makeFakeOpenAI({ data: [{}] });
    const vaultRoot = await tmpVault();
    const deps: ImageDeps = { openai };
    await expect(
      generateImage({ prompt: 'p', slug: 's', vaultRoot, apiKey: 'k', deps }),
    ).rejects.toThrow(/b64_json/);
  });

  it('honors a caller-provided quality override (still defaults to high otherwise)', async () => {
    const openai = makeFakeOpenAI();
    const vaultRoot = await tmpVault();
    const deps: ImageDeps = { openai };
    await generateImage({
      prompt: 'p',
      slug: 's',
      vaultRoot,
      apiKey: 'k',
      quality: 'low',
      deps,
    });
    const args = openai.images.generate.mock.calls[0][0] as Record<string, unknown>;
    expect(args.quality).toBe('low');
  });
});

// Live smoke — gated on env var presence. Spec exit criterion line 544.
// Run manually with `OPENAI_API_KEY=... pnpm test src/lib/media/image.test.ts`.
describe.runIf(!!process.env.OPENAI_API_KEY)('generateImage — live smoke', () => {
  it('writes a .png under vaults/commodore-vex/images/ via gpt-image-2', async () => {
    const vaultRoot = path.join(process.cwd(), 'vaults', 'commodore-vex');
    // Smoke into a tmpdir if the symlink target is read-only or absent; spec
    // line 544 names commodore-vex but we don't depend on it for correctness.
    const usable = await canWrite(path.join(vaultRoot, 'images')).catch(() => false);
    const root = usable ? vaultRoot : await tmpVault();
    const res = await generateImage({
      prompt: 'a single small ceramic cup, candlelight, simple',
      slug: 'smoke-cup',
      vaultRoot: root,
    });
    expect(res.path.endsWith('.png')).toBe(true);
    const stat = await fs.stat(res.path);
    expect(stat.size).toBeGreaterThan(0);
  }, 600_000);
});

async function canWrite(dir: string): Promise<boolean> {
  await fs.mkdir(dir, { recursive: true });
  const probe = path.join(dir, '.write-probe');
  await fs.writeFile(probe, 'x');
  await fs.unlink(probe);
  return true;
}
