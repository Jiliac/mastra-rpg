import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import OpenAI from 'openai';
import type { ImageMeta } from '../schemas';

const OPENAI_MODEL = 'gpt-image-2';
const DEFAULT_SIZE = '1024x1024';
const DEFAULT_QUALITY = 'high';

/**
 * Minimal structural type for the `openai` client. `generateImage` only
 * calls `client.images.generate(args)`. Tests inject a fake of this shape
 * via `ImageDeps.openai` without instantiating the real SDK.
 */
export interface OpenAILike {
  images: {
    generate(args: {
      model: string;
      prompt: string;
      n: number;
      size: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
      quality: 'low' | 'medium' | 'high' | 'auto';
    }): Promise<{ data?: Array<{ b64_json?: string }> }>;
  };
}

export interface ImageDeps {
  openai?: OpenAILike;
}

export interface GenerateImageInput {
  prompt: string;
  /** Descriptive slug used in the filename. Empty → `'scene'`. */
  slug: string;
  /** Absolute path to the vault root; PNG lands under `<vaultRoot>/images/`. */
  vaultRoot: string;
  /** OpenAI API key. Defaults to `process.env.OPENAI_API_KEY`. */
  apiKey?: string;
  /** OpenAI image size; default `'1024x1024'`. */
  size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
  /** OpenAI image quality; default `'high'`. */
  quality?: 'low' | 'medium' | 'high' | 'auto';
  deps?: ImageDeps;
}

/**
 * Generate an image via OpenAI `gpt-image-2` (default quality `'high'`) and
 * write the PNG into
 * `<vaultRoot>/images/<YYYYMMDD>-<HHMMSS>-<slug>-<6char-rand>.png`.
 * Returns the `ImageMeta` record matching `src/lib/schemas.ts`.
 *
 * Concurrency invariant §4: the 6-char random suffix prevents same-second
 * collisions across parallel image-tool calls.
 *
 * The SDK client is the only IO seam; inject `deps.openai` to stub it in
 * tests. Auth is handled by the SDK — pass `apiKey` or set
 * `OPENAI_API_KEY`; the SDK retries/backs-off internally on 5xx.
 */
export async function generateImage(input: GenerateImageInput): Promise<ImageMeta> {
  const openai = input.deps?.openai ?? defaultClient(input.apiKey);
  const size = input.size ?? DEFAULT_SIZE;
  const quality = input.quality ?? DEFAULT_QUALITY;

  const result = await openai.images.generate({
    model: OPENAI_MODEL,
    prompt: input.prompt,
    n: 1,
    size,
    quality,
  });

  const b64 = result.data?.[0]?.b64_json;
  if (typeof b64 !== 'string' || b64.length === 0) {
    throw new Error('generateImage: OpenAI response missing data[0].b64_json');
  }

  const filename = buildFilename(input.slug);
  const dir = path.join(input.vaultRoot, 'images');
  await fs.mkdir(dir, { recursive: true });
  const outPath = path.join(dir, filename);
  await fs.writeFile(outPath, Buffer.from(b64, 'base64'));

  return {
    filename,
    path: outPath,
    prompt: input.prompt,
    slug: input.slug,
  };
}

function defaultClient(apiKey?: string): OpenAILike {
  const key = apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error('generateImage: missing OPENAI_API_KEY (pass apiKey or set env var)');
  }
  // Cast through `unknown` because the SDK's actual `images.generate` return
  // type carries more fields than our minimal `OpenAILike`.
  return new OpenAI({ apiKey: key }) as unknown as OpenAILike;
}

export interface BuildFilenameOptions {
  /** Override the clock; tests pin this to assert the timestamp prefix. */
  now?: Date;
}

/**
 * Compose the filename `YYYYMMDD-HHMMSS-<slug>-<6char-rand>.png`.
 * Slug is lowercased and ASCII-slugified (spaces → dashes; anything outside
 * `[a-z0-9-]` is stripped). Empty slug → `'scene'`.
 */
export function buildFilename(slug: string, options: BuildFilenameOptions = {}): string {
  const now = options.now ?? new Date();
  const ts = formatTimestamp(now);
  const safeSlug = slugify(slug) || 'scene';
  // 3 bytes = exactly 6 hex chars = 24 bits of entropy
  // (~1 in 16.7 million collisions per slug-second).
  const rand = crypto.randomBytes(3).toString('hex');
  return `${ts}-${safeSlug}-${rand}.png`;
}

function formatTimestamp(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  // Use UTC to keep filenames deterministic across machines + CI.
  const Y = d.getUTCFullYear();
  const M = pad(d.getUTCMonth() + 1);
  const D = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const m = pad(d.getUTCMinutes());
  const s = pad(d.getUTCSeconds());
  return `${Y}${M}${D}-${h}${m}${s}`;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}
