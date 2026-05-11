import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ttsRender, type TtsDeps, type InworldTtsLike } from './tts';

const SAMPLE_BYTES = new Uint8Array(Buffer.from('fake-ogg-bytes'));

/**
 * Fake InworldTTS-shaped object. `ttsRender` only ever calls
 * `client.generate(args)` and expects a `Uint8Array` back, so we don't have
 * to mirror the entire SDK surface — only the `generate` method.
 */
function makeFakeInworld(bytes: Uint8Array | Error = SAMPLE_BYTES): InworldTtsLike & {
  generate: ReturnType<typeof vi.fn>;
} {
  const generate = vi.fn(async (_args: Record<string, unknown>) => {
    if (bytes instanceof Error) throw bytes;
    return bytes;
  });
  return { generate };
}

async function tmpOgg(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-tts-'));
  return path.join(dir, 'out.ogg');
}

describe('ttsRender', () => {
  it('calls InworldTTS.generate with the right text, voice, model, and encoding', async () => {
    const inworld = makeFakeInworld();
    const out = await tmpOgg();
    const deps: TtsDeps = { inworld };

    await ttsRender('hello world', {
      voice: 'Hank',
      output: out,
      apiKey: 'secret',
      deps,
    });

    expect(inworld.generate).toHaveBeenCalledTimes(1);
    const args = inworld.generate.mock.calls[0][0] as Record<string, unknown>;
    expect(args.text).toBe('hello world');
    expect(args.voice).toBe('Hank');
    expect(args.model).toBe('inworld-tts-2');
    expect(args.encoding).toBe('OGG_OPUS');
  });

  it('writes the returned OGG bytes to options.output and returns the absolute path', async () => {
    const inworld = makeFakeInworld();
    const out = await tmpOgg();
    const deps: TtsDeps = { inworld };

    const returned = await ttsRender('hello world', {
      voice: 'Hank',
      output: out,
      apiKey: 'k',
      deps,
    });
    expect(returned).toBe(out);
    const written = await fs.readFile(out);
    expect(written.equals(Buffer.from(SAMPLE_BYTES))).toBe(true);
  });

  it('throws when the SDK errors (e.g. 5xx surfaced as an SDK exception)', async () => {
    const inworld = makeFakeInworld(new Error('Inworld 500: server boom'));
    const out = await tmpOgg();
    const deps: TtsDeps = { inworld };

    await expect(
      ttsRender('hello', { voice: 'Hank', output: out, apiKey: 'k', deps }),
    ).rejects.toThrow(/server boom/);
  });

  it('creates the output directory if missing', async () => {
    const inworld = makeFakeInworld();
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-tts-mkdir-'));
    const out = path.join(baseDir, 'nested', 'dir', 'out.ogg');
    const deps: TtsDeps = { inworld };

    await ttsRender('hello', { voice: 'Hank', output: out, apiKey: 'k', deps });
    const stat = await fs.stat(out);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('forwards optional speakingRate and temperature to the SDK when provided', async () => {
    const inworld = makeFakeInworld();
    const out = await tmpOgg();
    const deps: TtsDeps = { inworld };

    await ttsRender('hello world', {
      output: out,
      deps,
      speakingRate: 1.2,
      temperature: 0.7,
    });

    expect(inworld.generate).toHaveBeenCalledTimes(1);
    const args = inworld.generate.mock.calls[0][0] as Record<string, unknown>;
    expect(args.speakingRate).toBe(1.2);
    expect(args.temperature).toBe(0.7);
  });

  it('throws when API key is missing (no apiKey arg + no env var + no injected client)', async () => {
    const prev = process.env.INWORLD_API_KEY;
    delete process.env.INWORLD_API_KEY;
    const out = await tmpOgg();
    try {
      await expect(ttsRender('hello', { voice: 'Hank', output: out })).rejects.toThrow(
        /INWORLD_API_KEY/,
      );
    } finally {
      if (prev !== undefined) process.env.INWORLD_API_KEY = prev;
    }
  });
});

// Live smoke — gated on env var presence. Spec exit criterion line 543.
// Run manually with `INWORLD_API_KEY=... pnpm test src/lib/media/tts.test.ts`.
describe.runIf(!!process.env.INWORLD_API_KEY)('ttsRender — live smoke', () => {
  it('produces a non-empty .ogg for "hello world" via @inworld/tts SDK', async () => {
    const out = await tmpOgg();
    const returned = await ttsRender('hello world', { voice: 'Hank', output: out });
    expect(returned).toBe(out);
    const stat = await fs.stat(out);
    expect(stat.size).toBeGreaterThan(0);
  });
});
