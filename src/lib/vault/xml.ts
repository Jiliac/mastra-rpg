import * as fs from 'node:fs/promises';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { worldXmlPath, threadsXmlPath, characterXmlPath } from './paths';

// Shared options. preserveOrder + trimValues:false + format:false is the
// combination that round-trips whitespace identically. ignoreAttributes:false
// and the @_ prefix retain attributes through the round-trip.
const PARSER_OPTS = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: false,
} as const;

const BUILDER_OPTS = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: false,
  suppressEmptyNode: false,
} as const;

/** Opaque doc handle; consumers should treat as unknown and use typed parsers. */
export type XmlDoc = unknown;

const parser = new XMLParser(PARSER_OPTS);
const builder = new XMLBuilder(BUILDER_OPTS);

export async function readXml(filePath: string): Promise<XmlDoc> {
  const raw = await fs.readFile(filePath, 'utf8');
  return parser.parse(raw);
}

export async function writeXml(filePath: string, doc: XmlDoc): Promise<void> {
  const built = builder.build(doc) as string;
  // fast-xml-parser's builder strips the trailing newline. Re-append one so
  // round-trip equality holds against POSIX-conventional files (which end in \n).
  const out = built.endsWith('\n') ? built : built + '\n';
  await fs.writeFile(filePath, out, 'utf8');
}

// ---- Typed views ---------------------------------------------------------

export interface WorldView {
  date: string;
  calendar: string;
  region: string;
  city: string;
  placeSlug: string;
  weather: string;
  season: string;
  notes: string[];
}

export interface ThreadView {
  id: string;
  name: string;
  stake: string;
  progress: string;
  trigger: string;
}

export interface CharacterView {
  name: string;
  age: string;
  role: string;
  background: string;
  skills: string;
  inventory: { significance: string; text: string }[];
  wealth: string;
  reputation: { slug: string; text: string }[];
  relationships: { slug: string; text: string }[];
}

// ---- Helpers to navigate the preserveOrder shape -------------------------

type OrderedNode = Record<string, unknown>;

/** Find the first child node whose key matches `tag`. Returns its value array or undefined. */
function findChild(parent: OrderedNode[], tag: string): OrderedNode[] | undefined {
  for (const node of parent) {
    if (tag in node) return node[tag] as OrderedNode[];
  }
  return undefined;
}

/** Concatenate text nodes inside a child array into a single string. */
function textOf(parent: OrderedNode[] | undefined): string {
  if (!parent) return '';
  let out = '';
  for (const node of parent) {
    if ('#text' in node) out += String(node['#text']);
  }
  return out;
}

/** Read the attributes object (`':@'`) from an element node. */
function attrsOf(node: OrderedNode): Record<string, string> {
  return (node[':@'] as Record<string, string>) ?? {};
}

/** Find the first element-node (i.e. has the given tag as a key) in a child array. */
function findEl(parent: OrderedNode[], tag: string): OrderedNode | undefined {
  for (const node of parent) {
    if (tag in node) return node;
  }
  return undefined;
}

// ---- Typed parsers -------------------------------------------------------

export async function parseWorldXml(root: string): Promise<WorldView> {
  const doc = (await readXml(worldXmlPath(root))) as OrderedNode[];
  const world = findChild(doc, 'world');
  if (!world) throw new Error('world.xml missing <world> root');

  const dateNode = findEl(world, 'date');
  const locationChildren = findChild(world, 'location');
  const placeNode = locationChildren ? findEl(locationChildren, 'place') : undefined;
  const conditionsChildren = findChild(world, 'conditions');

  const notes: string[] = [];
  if (conditionsChildren) {
    for (const node of conditionsChildren) {
      if ('note' in node) notes.push(textOf(node.note as OrderedNode[]));
    }
  }

  return {
    date: textOf(dateNode?.date as OrderedNode[] | undefined),
    calendar: dateNode ? (attrsOf(dateNode)['@_calendar'] ?? '') : '',
    region: textOf(locationChildren ? findChild(locationChildren, 'region') : undefined),
    city: textOf(locationChildren ? findChild(locationChildren, 'city') : undefined),
    placeSlug: placeNode ? (attrsOf(placeNode)['@_slug'] ?? '') : '',
    weather: textOf(findChild(world, 'weather')),
    season: textOf(findChild(world, 'season')),
    notes,
  };
}

export async function parseThreadsXml(root: string): Promise<ThreadView[]> {
  const doc = (await readXml(threadsXmlPath(root))) as OrderedNode[];
  const threads = findChild(doc, 'threads');
  if (!threads) return [];
  const out: ThreadView[] = [];
  for (const node of threads) {
    if (!('thread' in node)) continue;
    const id = attrsOf(node)['@_id'] ?? '';
    const children = node.thread as OrderedNode[];
    out.push({
      id,
      name: textOf(findChild(children, 'name')),
      stake: textOf(findChild(children, 'stake')),
      progress: textOf(findChild(children, 'progress')),
      trigger: textOf(findChild(children, 'trigger')),
    });
  }
  return out;
}

export async function parseCharacterXml(root: string): Promise<CharacterView> {
  const doc = (await readXml(characterXmlPath(root))) as OrderedNode[];
  const ch = findChild(doc, 'character');
  if (!ch) throw new Error('character.xml missing <character> root');

  const inventoryChildren = findChild(ch, 'inventory') ?? [];
  const inventory: CharacterView['inventory'] = [];
  for (const node of inventoryChildren) {
    if (!('item' in node)) continue;
    inventory.push({
      significance: attrsOf(node)['@_significance'] ?? '',
      text: textOf(node.item as OrderedNode[]),
    });
  }

  const reputationChildren = findChild(ch, 'reputation') ?? [];
  const reputation: CharacterView['reputation'] = [];
  for (const node of reputationChildren) {
    if (!('faction' in node)) continue;
    reputation.push({
      slug: attrsOf(node)['@_slug'] ?? '',
      text: textOf(node.faction as OrderedNode[]),
    });
  }

  const relChildren = findChild(ch, 'relationships') ?? [];
  const relationships: CharacterView['relationships'] = [];
  for (const node of relChildren) {
    if (!('npc' in node)) continue;
    relationships.push({
      slug: attrsOf(node)['@_slug'] ?? '',
      text: textOf(node.npc as OrderedNode[]),
    });
  }

  return {
    name: textOf(findChild(ch, 'name')),
    age: textOf(findChild(ch, 'age')),
    role: textOf(findChild(ch, 'role')),
    background: textOf(findChild(ch, 'background')),
    skills: textOf(findChild(ch, 'skills')),
    inventory,
    wealth: textOf(findChild(ch, 'wealth')),
    reputation,
    relationships,
  };
}
