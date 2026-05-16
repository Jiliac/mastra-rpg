// src/app/api/turn/image/route.ts
//
// GET /api/turn/image?slug=<slug>&filename=<name>
//
// Streams an image file out of `<vaultRoot(slug)>/images/<name>` with a
// strict path-traversal guard. Used by the chat UI to render the
// illustrator's images, which live outside `public/` and therefore
// can't be served as static assets.

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

  const root = path.resolve(vaultRoot(slug), 'images');
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
      'content-type': 'image/png',
      'cache-control': 'private, max-age=3600',
    },
  });
}
