// src/app/api/turn/audio/route.ts
//
// GET /api/turn/audio?slug=<slug>&filename=<name>
//
// Mirror of /api/turn/image, serving `<vaultRoot(slug)>/audio/<name>` as
// `audio/ogg`. The Inworld TTS pipeline writes `.ogg` files (see Wave-3
// `src/lib/media/tts.ts`), so this is the only audio MIME type we need
// to handle for v0.

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { vaultRoot } from '@/lib/vault/paths';

export const dynamic = 'force-dynamic';

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

  let bytes: Buffer;
  try {
    bytes = await readFile(requested);
  } catch {
    return new Response('not found', { status: 404 });
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'content-type': 'audio/ogg',
      'cache-control': 'private, max-age=3600',
      // Range requests aren't supported in v0 — the audio file is small
      // enough (one turn = ~30s of narrator prose) that a full GET is fine.
    },
  });
}
