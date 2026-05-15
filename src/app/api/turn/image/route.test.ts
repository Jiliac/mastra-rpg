import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GET } from './route';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

// We point the vault root at a tmp dir for the duration of the test.
// `vaultRoot(slug)` returns `<cwd>/vaults/<slug>`, so we create the
// expected layout under a temp `vaults/` we chdir into.
const ORIGINAL_CWD = process.cwd();
const TMP = path.join(ORIGINAL_CWD, '.tmp-turn-image-route-test');
const SLUG = 'fixture';
const IMG_DIR = path.join(TMP, 'vaults', SLUG, 'images');

beforeAll(async () => {
  await mkdir(IMG_DIR, { recursive: true });
  await writeFile(path.join(IMG_DIR, 'ok.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  process.chdir(TMP);
});

afterAll(async () => {
  process.chdir(ORIGINAL_CWD);
  await rm(TMP, { recursive: true, force: true });
});

function req(qs: string): Request {
  return new Request(`http://test/api/turn/image?${qs}`);
}

describe('GET /api/turn/image', () => {
  it('serves a valid file', async () => {
    const res = await GET(req(`slug=${SLUG}&filename=ok.png`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0x89);
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
    const res = await GET(req(`slug=${SLUG}&filename=does-not-exist.png`));
    expect(res.status).toBe(404);
  });

  it('400s on missing slug or filename', async () => {
    expect((await GET(req(`filename=ok.png`))).status).toBe(400);
    expect((await GET(req(`slug=${SLUG}`))).status).toBe(400);
  });
});
