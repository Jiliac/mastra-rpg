/**
 * Wikilink parser, resolver, and TTS-strip for the vault.
 *
 * Supported syntax:
 *   [[target]]               — bare link
 *   [[target|alias]]         — link with display text
 *   [[folder/slug]]          — folder-prefixed link (folder ∈ {npcs, locations, factions})
 *   [[folder/slug|alias]]    — folder-prefixed link with display text
 *   ![[target]]              — embed (typically images); `embed: true`
 *
 * Resolution rules (v0 — folder-prefix or bust):
 *   - Folder-prefix wins. `[[npcs/foo]]` → kind=npc, slug=foo, found = (slug ∈ registry.npcs).
 *   - Bare links default to kind=npc, found=false (stub candidate). No alias lookup in v0.
 *     This dodges the alias-precedence problem (which kind wins when "Twin" matches multiple);
 *     v0.5 may add alias resolution if writers chafe under the folder-prefix discipline.
 *
 * TTS-strip rules (per spec lines 256-258):
 *   - Alias wins: `[[npcs/kessha|Kessha]]` → `Kessha`.
 *   - No alias, folder-prefixed: emit the slug deslugified (`-` → space).
 *   - No alias, bare: emit target verbatim.
 *   - Embeds: dropped entirely.
 */

export interface ParsedLink {
  raw: string;
  target: string;
  alias?: string;
  embed: boolean;
}

export type Kind = 'npc' | 'location' | 'faction' | 'image';

export interface ResolvedLink {
  kind: Kind;
  slug: string;
  found: boolean;
}

export interface AliasRegistry {
  /** Known slug sets per kind. Only used for the `found` flag on folder-prefixed links. */
  npcs: Set<string>;
  locations: Set<string>;
  factions: Set<string>;
}

// Match either an embed (![[...]]) or a plain wikilink ([[...]]). Captures:
//   group 1: '!' if embed, '' otherwise
//   group 2: the inner content (target + optional |alias)
const WIKILINK_RE = /(!?)\[\[([^\]]+)\]\]/g;

export function parseWikilinks(text: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  for (const match of text.matchAll(WIKILINK_RE)) {
    const [raw, bang, inner] = match;
    const pipeIdx = inner.indexOf('|');
    const target = pipeIdx === -1 ? inner : inner.slice(0, pipeIdx);
    const alias = pipeIdx === -1 ? undefined : inner.slice(pipeIdx + 1);
    links.push({ raw, target, alias, embed: bang === '!' });
  }
  return links;
}

// Tighter than Record<string, Kind>: the values exclude 'image' so callers
// can index KIND_TO_REGISTRY_KEY without a narrowing guard.
type FolderKind = Exclude<Kind, 'image'>;
const FOLDER_TO_KIND: Record<string, FolderKind> = {
  npcs: 'npc',
  locations: 'location',
  factions: 'faction',
};

const KIND_TO_REGISTRY_KEY = {
  npc: 'npcs',
  location: 'locations',
  faction: 'factions',
} as const;

// Lower-case + whitespace → dash. Anything else (unicode, punctuation) is
// left in place — if a writer puts weird chars in a bare link, they get the
// slug they earned. v0 is folder-prefix-or-bust; bare links are stub-fodder anyway.
function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-');
}

export function resolveWikilink(
  link: Pick<ParsedLink, 'target' | 'embed'>,
  registry: AliasRegistry,
): ResolvedLink {
  if (link.embed) {
    return { kind: 'image', slug: link.target, found: false };
  }

  const slashIdx = link.target.indexOf('/');
  if (slashIdx > 0) {
    const folder = link.target.slice(0, slashIdx);
    const slug = link.target.slice(slashIdx + 1);
    const kind = FOLDER_TO_KIND[folder];
    if (kind) {
      const found = registry[KIND_TO_REGISTRY_KEY[kind]].has(slug);
      return { kind, slug, found };
    }
    // Unknown folder prefix: treat as bare and slugify the whole thing.
  }

  // Bare link: default to kind=npc, found=false. No alias lookup in v0.
  return { kind: 'npc', slug: slugify(link.target), found: false };
}

/**
 * Replace wikilinks in text for TTS rendering. Returns the modified string.
 * - Alias if present.
 * - Otherwise, deslugify the slug (strip kind-folder, replace `-` with space).
 * - Embeds are removed.
 */
export function stripForTts(text: string): string {
  return text.replace(WIKILINK_RE, (_raw, bang, inner) => {
    if (bang === '!') return '';

    const pipeIdx = inner.indexOf('|');
    // Split target from alias up front so the fall-through path works on
    // just the target. Empty/whitespace alias (`[[npcs/foo|]]`) falls
    // through to deslug rather than disappearing the link from audio.
    const target = pipeIdx === -1 ? inner : inner.slice(0, pipeIdx);
    if (pipeIdx !== -1) {
      const alias = inner.slice(pipeIdx + 1).trim();
      if (alias !== '') return alias;
    }

    // No usable alias. Strip the kind-folder if present, then deslugify.
    const slashIdx = target.indexOf('/');
    if (slashIdx > 0) {
      const folder = target.slice(0, slashIdx);
      if (folder in FOLDER_TO_KIND) {
        const slug = target.slice(slashIdx + 1);
        return slug.replace(/-/g, ' ');
      }
    }
    // Bare link without a known folder: emit target verbatim.
    return target;
  });
}
