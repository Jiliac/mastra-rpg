// src/app/api/turn/audio/route.ts
//
// GET /api/turn/audio?slug=<slug>&filename=<name>
//
// Serves `<vaultRoot(slug)>/audio/<name>` as `audio/ogg`. The Inworld
// TTS pipeline writes Ogg Opus files (see Wave-3 `src/lib/media/tts.ts`).
//
// Range support: Ogg duration is stored in the granule position of the
// LAST page. Without HTTP Range support the browser can't seek to the
// end to read the duration, so <audio>.duration stays NaN and the
// MediaDurationDisplay renders "0:00". Honoring `Range:` lets the
// browser fetch just the tail bytes and compute duration cheaply.

import path from 'node:path';
import { open, stat } from 'node:fs/promises';
import { vaultRoot } from '@/lib/vault/paths';

export const dynamic = 'force-dynamic';

const COMMON_HEADERS = {
  'content-type': 'audio/ogg',
  'cache-control': 'private, max-age=3600',
  'accept-ranges': 'bytes',
} as const;

/** Parse a single `bytes=start-end` range. Multi-range is not supported. */
function parseRange(
  header: string,
  size: number,
): { start: number; end: number } | 'invalid' | null {
  if (!header.startsWith('bytes=')) return null;
  const spec = header.slice('bytes='.length);
  if (spec.includes(',')) return 'invalid';
  const dash = spec.indexOf('-');
  if (dash === -1) return 'invalid';
  const startStr = spec.slice(0, dash);
  const endStr = spec.slice(dash + 1);

  let start: number;
  let end: number;
  if (startStr === '') {
    // suffix range: `-N` means "last N bytes"
    const n = Number.parseInt(endStr, 10);
    if (!Number.isFinite(n) || n <= 0) return 'invalid';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number.parseInt(startStr, 10);
    if (!Number.isFinite(start) || start < 0) return 'invalid';
    end = endStr === '' ? size - 1 : Number.parseInt(endStr, 10);
    if (!Number.isFinite(end) || end < start) return 'invalid';
    if (end >= size) end = size - 1;
  }
  if (start >= size) return 'invalid';
  return { start, end };
}

async function readSlice(
  filePath: string,
  start: number,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const fh = await open(filePath, 'r');
  try {
    const ab = new ArrayBuffer(length);
    const view = new Uint8Array(ab);
    await fh.read(view, 0, length, start);
    return view;
  } finally {
    await fh.close();
  }
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug');
  const filename = url.searchParams.get('filename');
  if (!slug || !filename) {
    return new Response('missing slug or filename', { status: 400 });
  }

  const root = path.resolve(vaultRoot(slug), 'audio');
  const requested = path.resolve(root, filename);
  if (!requested.startsWith(root + path.sep) && requested !== root) {
    return new Response('not found', { status: 404 });
  }

  let size: number;
  try {
    const st = await stat(requested);
    if (!st.isFile()) return new Response('not found', { status: 404 });
    size = st.size;
  } catch {
    return new Response('not found', { status: 404 });
  }

  const rangeHeader = req.headers.get('range');
  if (rangeHeader) {
    const parsed = parseRange(rangeHeader, size);
    if (parsed === 'invalid') {
      return new Response('invalid range', {
        status: 416,
        headers: { 'content-range': `bytes */${size}` },
      });
    }
    if (parsed !== null) {
      const { start, end } = parsed;
      const length = end - start + 1;
      const slice = await readSlice(requested, start, length);
      return new Response(slice, {
        status: 206,
        headers: {
          ...COMMON_HEADERS,
          'content-length': String(length),
          'content-range': `bytes ${start}-${end}/${size}`,
        },
      });
    }
  }

  const bytes = await readSlice(requested, 0, size);
  return new Response(bytes, {
    status: 200,
    headers: {
      ...COMMON_HEADERS,
      'content-length': String(size),
    },
  });
}
