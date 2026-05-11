import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseFrontmatter, type Frontmatter } from './frontmatter';
import {
  factionPath,
  factionsDir,
  npcPath,
  locationPath,
  styleGuidePath,
  zeroMapPath,
} from './paths';
import {
  parseWorldXml,
  parseThreadsXml,
  parseCharacterXml,
  type WorldView,
  type ThreadView,
  type CharacterView,
} from './xml';

export interface EntityDoc {
  slug: string;
  frontmatter: Frontmatter;
  body: string;
}

export interface MarkdownDoc {
  frontmatter: Frontmatter;
  body: string;
}

export interface AlwaysLoaded {
  world: WorldView;
  character: CharacterView;
  threads: ThreadView[];
  zeroMap: MarkdownDoc;
  styleGuide: MarkdownDoc;
  /** Keyed by faction slug. */
  factions: Record<string, EntityDoc>;
}

async function readMarkdown(filePath: string): Promise<MarkdownDoc> {
  const raw = await fs.readFile(filePath, 'utf8');
  return parseFrontmatter(raw);
}

async function readEntity(filePath: string, slug: string): Promise<EntityDoc> {
  const md = await readMarkdown(filePath);
  return { slug, frontmatter: md.frontmatter, body: md.body };
}

export function loadNpc(root: string, slug: string): Promise<EntityDoc> {
  return readEntity(npcPath(root, slug), slug);
}

export function loadFaction(root: string, slug: string): Promise<EntityDoc> {
  return readEntity(factionPath(root, slug), slug);
}

export function loadLocation(root: string, slug: string): Promise<EntityDoc> {
  return readEntity(locationPath(root, slug), slug);
}

export async function listFactions(root: string): Promise<string[]> {
  const entries = await fs.readdir(factionsDir(root), { withFileTypes: true });
  const slugs: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith('.md')) continue;
    if (e.name.startsWith('.')) continue;
    slugs.push(path.basename(e.name, '.md'));
  }
  return slugs;
}

export async function loadAlwaysLoaded(root: string): Promise<AlwaysLoaded> {
  const [world, character, threads, zeroMap, styleGuide, factionSlugs] = await Promise.all([
    parseWorldXml(root),
    parseCharacterXml(root),
    parseThreadsXml(root),
    readMarkdown(zeroMapPath(root)),
    readMarkdown(styleGuidePath(root)),
    listFactions(root),
  ]);

  const factionDocs = await Promise.all(factionSlugs.map((slug) => loadFaction(root, slug)));
  const factions: Record<string, EntityDoc> = {};
  for (const doc of factionDocs) factions[doc.slug] = doc;

  return { world, character, threads, zeroMap, styleGuide, factions };
}
