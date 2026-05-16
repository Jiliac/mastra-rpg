import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GET } from './route';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

// Mirrors src/app/api/turn/image/route.test.ts. `vaultRoot(slug)` returns
// `<cwd>/vaults/<slug>`, so we chdir into a tmp tree for the duration of
// the test. Uses a distinct TMP from the image test to avoid collisions
// if vitest co-locates them in the same worker process.
const ORIGINAL_CWD = process.cwd();
const TMP = path.join(ORIGINAL_CWD, '.tmp-turn-audio-route-test');
const SLUG = 'fixture';
const AUDIO_DIR = path.join(TMP, 'vaults', SLUG, 'audio');

beforeAll(async () => {
  await mkdir(AUDIO_DIR, { recursive: true });
  // OggS magic bytes — enough to identify the payload as something file-shaped.
  await writeFile(path.join(AUDIO_DIR, 'ok.ogg'), Buffer.from([0x4f, 0x67, 0x67, 0x53]));
  process.chdir(TMP);
});

afterAll(async () => {
  process.chdir(ORIGINAL_CWD);
  await rm(TMP, { recursive: true, force: true });
});

function req(qs: string): Request {
  return new Request(`http://test/api/turn/audio?${qs}`);
}

describe('GET /api/turn/audio', () => {
  it('serves a valid file with audio/ogg content-type', async () => {
    const res = await GET(req(`slug=${SLUG}&filename=ok.ogg`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/ogg');
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0x4f);
  });

  it('rejects path traversal', async () => {
    const res = await GET(req(`slug=${SLUG}&filename=../../../etc/passwd`));
    expect(res.status).toBe(404);
  });

  it('rejects an absolute filename', async () => {
    const res = await GET(req(`slug=${SLUG}&filename=/etc/passwd`));
    expect(res.status).toBe(404);
  });

  it('404s on missing file', async () => {
    const res = await GET(req(`slug=${SLUG}&filename=does-not-exist.ogg`));
    expect(res.status).toBe(404);
  });

  it('400s on missing slug or filename', async () => {
    expect((await GET(req(`filename=ok.ogg`))).status).toBe(400);
    expect((await GET(req(`slug=${SLUG}`))).status).toBe(400);
  });
});
