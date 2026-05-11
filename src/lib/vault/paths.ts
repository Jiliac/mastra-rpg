import path from 'node:path';

/**
 * Resolve the absolute path to a vault root: `<cwd>/vaults/<slug>`.
 * Tests bypass this entirely by passing fixture paths directly to file helpers.
 */
export function vaultRoot(slug: string): string {
  return path.join(process.cwd(), 'vaults', slug);
}

export const worldXmlPath = (root: string) => path.join(root, 'world.xml');
export const threadsXmlPath = (root: string) => path.join(root, 'threads.xml');
export const characterXmlPath = (root: string) => path.join(root, 'character.xml');
export const styleGuidePath = (root: string) => path.join(root, 'style-guide.md');
export const zeroMapPath = (root: string) => path.join(root, '0-Map.md');
export const journalPath = (root: string) => path.join(root, 'journal.md');

export const factionsDir = (root: string) => path.join(root, 'factions');
export const npcsDir = (root: string) => path.join(root, 'npcs');
export const locationsDir = (root: string) => path.join(root, 'locations');

export const factionPath = (root: string, slug: string) =>
  path.join(factionsDir(root), `${slug}.md`);
export const npcPath = (root: string, slug: string) => path.join(npcsDir(root), `${slug}.md`);
export const locationPath = (root: string, slug: string) =>
  path.join(locationsDir(root), `${slug}.md`);
