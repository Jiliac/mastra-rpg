import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { InworldTTS } from '@inworld/tts';

const INWORLD_MODEL = 'inworld-tts-2';
const DEFAULT_ENCODING = 'OGG_OPUS' as const;

/**
 * Minimal structural type for the `@inworld/tts` client — `ttsRender` only
 * calls `.generate(args)`. Tests inject a fake of this shape via
 * `TtsDeps.inworld` without having to construct a real SDK instance.
 */
export interface InworldTtsLike {
  generate(args: {
    text: string;
    voice: string;
    model: string;
    encoding: 'OGG_OPUS' | 'MP3' | 'LINEAR16';
    outputFile?: string;
    speakingRate?: number;
    temperature?: number;
  }): Promise<Uint8Array>;
}

/**
 * Dependency seams. The only IO boundary in this module is the Inworld SDK
 * client; tests pass in a fake `InworldTtsLike` to avoid network calls and
 * env-var setup.
 */
export interface TtsDeps {
  inworld?: InworldTtsLike;
}

export interface TtsOptions {
  /** Inworld voice id. Default: `'Hank'`. */
  voice?: string;
  /** Absolute path the final `.ogg` should be written to. Required. */
  output: string;
  /** Inworld API key. Defaults to `process.env.INWORLD_API_KEY`. */
  apiKey?: string;
  /** Per-request speaking-rate multiplier; passed through to the SDK if set. */
  speakingRate?: number;
  /** Per-request temperature; passed through to the SDK if set. */
  temperature?: number;
  deps?: TtsDeps;
}

/**
 * Render `text` to an OGG Opus file at `options.output` via the
 * `@inworld/tts` SDK (model `inworld-tts-2`, encoding `OGG_OPUS`).
 *
 * The SDK returns OGG bytes natively — no MP3 intermediate, no ffmpeg.
 * Throws on missing API key, on SDK errors (network, auth, quota), or on
 * filesystem failures.
 */
export async function ttsRender(text: string, options: TtsOptions): Promise<string> {
  // Default-injecting the real client requires the env var (or an
  // explicit apiKey). If the caller provides `deps.inworld`, they own
  // auth — we never read INWORLD_API_KEY in that case.
  const inworld = options.deps?.inworld ?? defaultClient(options.apiKey);
  const voice = options.voice ?? 'Hank';

  await fs.mkdir(path.dirname(options.output), { recursive: true });

  const args: Parameters<InworldTtsLike['generate']>[0] = {
    text,
    voice,
    model: INWORLD_MODEL,
    encoding: DEFAULT_ENCODING,
  };
  if (typeof options.speakingRate === 'number') args.speakingRate = options.speakingRate;
  if (typeof options.temperature === 'number') args.temperature = options.temperature;

  const bytes = await inworld.generate(args);
  await fs.writeFile(options.output, Buffer.from(bytes));
  return options.output;
}

function defaultClient(apiKey?: string): InworldTtsLike {
  const key = apiKey ?? process.env.INWORLD_API_KEY;
  if (!key) {
    throw new Error('ttsRender: missing INWORLD_API_KEY (pass apiKey or set env var)');
  }
  // The SDK accepts `{ apiKey }` or reads INWORLD_API_KEY from env on its own.
  // Casting through `unknown` because the SDK's TS surface and our minimal
  // `InworldTtsLike` may differ on optional fields (`outputFile`, `play`, …).
  return InworldTTS({ apiKey: key }) as unknown as InworldTtsLike;
}
