import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readXml, writeXml, parseWorldXml, parseThreadsXml, parseCharacterXml } from './xml';
import { worldXmlPath, threadsXmlPath } from './paths';

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

  describe('error and edge paths', () => {
    it('parseWorldXml throws when <world> root is missing', async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-xml-bad-world-'));
      try {
        await fs.writeFile(path.join(tmp, 'world.xml'), '<not-world></not-world>\n', 'utf8');
        await expect(parseWorldXml(tmp)).rejects.toThrow(/missing <world>/);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });

    it('parseCharacterXml throws when <character> root is missing', async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-xml-bad-char-'));
      try {
        await fs.writeFile(path.join(tmp, 'character.xml'), '<other></other>\n', 'utf8');
        await expect(parseCharacterXml(tmp)).rejects.toThrow(/missing <character>/);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });

    it('parseThreadsXml returns empty array when <threads> root is missing', async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-xml-empty-threads-'));
      try {
        await fs.writeFile(path.join(tmp, 'threads.xml'), '<other></other>\n', 'utf8');
        await expect(parseThreadsXml(tmp)).resolves.toEqual([]);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });

    it('parseWorldXml tolerates a minimal <world> with missing optional fields', async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-xml-minimal-world-'));
      try {
        // No <location>, no <conditions>, no <date> attrs. Exercises the
        // "missing child" undefined-fallback branches in the typed parser.
        await fs.writeFile(path.join(tmp, 'world.xml'), '<world><date>x</date></world>\n', 'utf8');
        const w = await parseWorldXml(tmp);
        expect(w.date).toBe('x');
        expect(w.calendar).toBe('');
        expect(w.region).toBe('');
        expect(w.city).toBe('');
        expect(w.placeSlug).toBe('');
        expect(w.weather).toBe('');
        expect(w.season).toBe('');
        expect(w.notes).toEqual([]);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });

    it('parseWorldXml handles a <location> without <place> (no placeSlug)', async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-xml-no-place-'));
      try {
        const xml = '<world><location><region>R</region></location></world>\n';
        await fs.writeFile(path.join(tmp, 'world.xml'), xml, 'utf8');
        const w = await parseWorldXml(tmp);
        expect(w.region).toBe('R');
        expect(w.placeSlug).toBe('');
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });

    it('parseThreadsXml skips text-only nodes and threads without an id', async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-xml-threads-noid-'));
      try {
        // <threads> with a thread that has no @id attribute — should still parse,
        // returning id: ''. Exercises the `attrsOf(node)['@_id'] ?? ''` fallback.
        const xml =
          '<threads><thread><name>X</name><progress>0/1</progress><stake>s</stake><trigger>t</trigger></thread></threads>\n';
        await fs.writeFile(path.join(tmp, 'threads.xml'), xml, 'utf8');
        const threads = await parseThreadsXml(tmp);
        expect(threads).toHaveLength(1);
        expect(threads[0].id).toBe('');
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });

    it('parseCharacterXml tolerates missing inventory, reputation, and relationships', async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rpg-xml-minimal-char-'));
      try {
        const xml = '<character><name>X</name></character>\n';
        await fs.writeFile(path.join(tmp, 'character.xml'), xml, 'utf8');
        const c = await parseCharacterXml(tmp);
        expect(c.name).toBe('X');
        expect(c.inventory).toEqual([]);
        expect(c.reputation).toEqual([]);
        expect(c.relationships).toEqual([]);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
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
