import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import { readXml, writeXml, parseWorldXml, parseThreadsXml, parseCharacterXml } from './xml';
import { worldXmlPath, threadsXmlPath, characterXmlPath } from './paths';

const FIXTURE = 'tests/fixtures/test-vault';

describe('xml', () => {
  describe('readXml / writeXml round-trip', () => {
    it('round-trips world.xml byte-for-byte (preserves whitespace + ordering)', async () => {
      const raw = await fs.readFile(worldXmlPath(FIXTURE), 'utf8');
      const doc = await readXml(worldXmlPath(FIXTURE));
      const tmpPath = `${FIXTURE}/.tmp-world-roundtrip.xml`;
      try {
        await writeXml(tmpPath, doc);
        const after = await fs.readFile(tmpPath, 'utf8');
        expect(after).toBe(raw);
      } finally {
        await fs.rm(tmpPath, { force: true });
      }
    });

    it('round-trips threads.xml byte-for-byte', async () => {
      const raw = await fs.readFile(threadsXmlPath(FIXTURE), 'utf8');
      const doc = await readXml(threadsXmlPath(FIXTURE));
      const tmpPath = `${FIXTURE}/.tmp-threads-roundtrip.xml`;
      try {
        await writeXml(tmpPath, doc);
        const after = await fs.readFile(tmpPath, 'utf8');
        expect(after).toBe(raw);
      } finally {
        await fs.rm(tmpPath, { force: true });
      }
    });
  });

  describe('parseWorldXml', () => {
    it('returns typed world view with date, location, weather, conditions', async () => {
      const world = await parseWorldXml(FIXTURE);
      expect(world.date).toBe('7 ABY, Month 4, Standard Day 20');
      expect(world.calendar).toBe('GSC');
      expect(world.region).toBe('Test Region');
      expect(world.city).toBe('Test City');
      expect(world.placeSlug).toBe('iron-promise');
      expect(world.weather).toBe('Clear, cold.');
      expect(world.season).toBe('Test season.');
      expect(world.notes).toEqual(['A test note.']);
    });
  });

  describe('parseThreadsXml', () => {
    it('returns all threads with progress strings preserved', async () => {
      const threads = await parseThreadsXml(FIXTURE);
      expect(threads).toHaveLength(3);
      expect(threads[0]).toMatchObject({
        id: 'fresh-clock',
        name: 'Fresh Clock',
        progress: '1/8',
      });
      expect(threads[1]).toMatchObject({ id: 'mid-clock', progress: '4/7' });
      expect(threads[2]).toMatchObject({ id: 'matured-clock', progress: '5/5' });
    });

    it('preserves trigger and stake fields', async () => {
      const threads = await parseThreadsXml(FIXTURE);
      expect(threads[0].stake).toBe('A clock that has barely started.');
      expect(threads[0].trigger).toBe('Advances by standard days.');
    });
  });

  describe('parseCharacterXml', () => {
    it('returns typed character view with repeated <faction> tags as array', async () => {
      const character = await parseCharacterXml(FIXTURE);
      expect(character.name).toBe('Test Captain');
      expect(character.reputation).toHaveLength(2);
      expect(character.reputation[0]).toEqual({ slug: 'red-banner', text: 'tolerated' });
      expect(character.reputation[1]).toEqual({ slug: 'blue-river', text: 'unknown' });
    });

    it('returns relationships array with slug + text', async () => {
      const character = await parseCharacterXml(FIXTURE);
      expect(character.relationships).toEqual([{ slug: 'kessha', text: 'first mate' }]);
    });
  });

  describe('writeXml mutation preserves surrounding whitespace', () => {
    it('mutating one progress field leaves other tags identical', async () => {
      const raw = await fs.readFile(threadsXmlPath(FIXTURE), 'utf8');
      const doc = await readXml(threadsXmlPath(FIXTURE));
      // Simulate Wave 2's mutation: change fresh-clock progress from 1/8 to 2/8.
      // We know the doc shape is preserveOrder array form; mutate in place.
      mutateThreadProgress(doc, 'fresh-clock', '2/8');
      const tmpPath = `${FIXTURE}/.tmp-mutate.xml`;
      try {
        await writeXml(tmpPath, doc);
        const after = await fs.readFile(tmpPath, 'utf8');
        expect(after).not.toBe(raw); // changed
        expect(after).toContain('2/8'); // new value present
        expect(after).toContain('4/7'); // other clock untouched
        expect(after).toContain('5/5'); // other clock untouched
        expect(after).toContain('<thread id="mid-clock">'); // structure intact
      } finally {
        await fs.rm(tmpPath, { force: true });
      }
    });
  });
});

// Inline helper used only by the mutation test. Walks the preserveOrder doc
// looking for a thread with the given id and rewrites its <progress> text.
// Lives in the test because Wave 1 doesn't ship a mutator — that's Wave 2.
function mutateThreadProgress(doc: unknown, threadId: string, newProgress: string): void {
  // doc is preserveOrder structure: Array<{ tagName: childArray, ':@'?: attrs }>
  const root = doc as Array<Record<string, unknown>>;
  const threadsNode = root.find((n) => 'threads' in n);
  const threadsChildren = threadsNode!.threads as Array<Record<string, unknown>>;
  for (const child of threadsChildren) {
    if (!('thread' in child)) continue;
    const attrs = child[':@'] as Record<string, string> | undefined;
    if (attrs?.['@_id'] !== threadId) continue;
    const threadChildren = child.thread as Array<Record<string, unknown>>;
    for (const tc of threadChildren) {
      if (!('progress' in tc)) continue;
      const progressArr = tc.progress as Array<{ '#text': string }>;
      progressArr[0]['#text'] = newProgress;
    }
  }
}
