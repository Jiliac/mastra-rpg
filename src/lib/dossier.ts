import type { EntityDoc } from './vault/entities';
import type { WorldView, CharacterView, ThreadView } from './vault/xml';
import type { JournalEntry } from './vault/journal';
import { parseWikilinks } from './vault/wikilinks';

// ---- types --------------------------------------------------------------

export interface OnStage {
  npcs: EntityDoc[];
  locations: EntityDoc[];
  /** Deduped faction slugs spawned by the on-stage NPCs. */
  factionsToSpawn: string[];
}

export interface IdentifyOnStageInput {
  playerInput: string;
  recent: JournalEntry[];
  /** All currently-loaded entities (npcs + locations + factions). */
  entities: EntityDoc[];
}

export interface BuildFactionDossierInput {
  faction: EntityDoc;
  onStage: OnStage;
  recent: JournalEntry[];
  world: WorldView;
  character: CharacterView;
  playerInput: string;
}

export interface BuildNarratorDossierInput {
  world: WorldView;
  character: CharacterView;
  threads: ThreadView[];
  styleGuide: string;
  onStage: OnStage;
  recent: JournalEntry[];
  factionDecisions: { slug: string; decision: string }[];
  playerInput: string;
  turnId: string;
}

export interface BuildIllustratorDossierInput {
  narratorProse: string;
  /** The ## Visual block text only (no heading). Caller calls extractVisualBlock first. */
  styleGuideVisual: string;
  onStage: OnStage;
}

export interface BuildLoremasterDossierInput {
  world: WorldView;
  character: CharacterView;
  threads: ThreadView[];
  factions: EntityDoc[];
  recent: JournalEntry[];
  playerInput: string;
}

// ---- extractVisualBlock --------------------------------------------------

/**
 * Returns the body of the `## Visual` section in a style-guide markdown,
 * stripped of leading/trailing whitespace. Returns `null` if the section
 * is absent. Mirrors OpenClaw `image.py:_VISUAL_RE` (Python's `\Z` end-of-
 * string anchor is not a valid JS regex token — we anchor the trailing
 * alternative with `$(?![\s\S])`, a negative-lookahead that pins `$` to
 * true end-of-input. The leading `^## Visual` still uses `m`-mode so the
 * heading is matched on its own line; `$` alone with the `m` flag would
 * incorrectly match at every line break, truncating multi-line blocks).
 */
const VISUAL_RE = /^## Visual\s*\n([\s\S]*?)(?=\n## |$(?![\s\S]))/m;

export function extractVisualBlock(styleGuide: string): string | null {
  const m = styleGuide.match(VISUAL_RE);
  if (!m) return null;
  return m[1].trim();
}

// ---- identifyOnStage -----------------------------------------------------

/**
 * Deterministic on-stage detector. An NPC or location is "on stage" if:
 *  - its slug appears as a wikilink target in the player input or any recent
 *    journal entry (`[[npcs/foo]]`, `[[locations/bar]]`), OR
 *  - any of its aliases (case-insensitive substring match on a word boundary)
 *    appears in the player input or recent journal text.
 *
 * `factionsToSpawn` = deduped list of `npcs[i].frontmatter.faction` strings
 * for every on-stage NPC that has one. Order is the insertion order of first
 * encounter, so the workflow's parallel fan-out is deterministic.
 */
export function identifyOnStage(input: IdentifyOnStageInput): OnStage {
  const haystack = [input.playerInput, ...input.recent.map((e) => e.heading + '\n' + e.body)].join(
    '\n',
  );
  const haystackLower = haystack.toLowerCase();
  const links = parseWikilinks(haystack).map((l) => l.target.toLowerCase());

  const npcs: EntityDoc[] = [];
  const locations: EntityDoc[] = [];
  // Caller (the workflow in Wave 5) MUST pass `entities[]` with unique slugs
  // per (kind, slug) pair — typically just the AlwaysLoaded set deduped at
  // load time. We do NOT carry a `seen` Set here because doing so would mask
  // upstream bugs where the same NPC is loaded twice; the workflow's vault
  // loader is the right place to enforce uniqueness.
  for (const e of input.entities) {
    const tags = Array.isArray(e.frontmatter.tags) ? (e.frontmatter.tags as string[]) : [];
    const kind = tags.includes('npc') ? 'npc' : tags.includes('location') ? 'location' : null;
    if (kind === null) continue;
    const folder = kind === 'npc' ? 'npcs' : 'locations';
    const linkMatch = links.some((t) => t === `${folder}/${e.slug}` || t === e.slug);
    const aliasMatch = aliasHit(haystackLower, e);
    if (!linkMatch && !aliasMatch) continue;
    (kind === 'npc' ? npcs : locations).push(e);
  }

  const seen = new Set<string>();
  const factionsToSpawn: string[] = [];
  for (const n of npcs) {
    const f = n.frontmatter.faction;
    if (typeof f !== 'string' || f.length === 0) continue;
    if (seen.has(f)) continue;
    seen.add(f);
    factionsToSpawn.push(f);
  }

  return { npcs, locations, factionsToSpawn };
}

function aliasHit(haystackLower: string, entity: EntityDoc): boolean {
  const aliases = Array.isArray(entity.frontmatter.aliases)
    ? (entity.frontmatter.aliases as string[])
    : [];
  for (const a of aliases) {
    if (a.length === 0) continue;
    const re = new RegExp(`\\b${escapeRegex(a.toLowerCase())}\\b`);
    if (re.test(haystackLower)) return true;
  }
  return false;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---- dossier builders ----------------------------------------------------

/**
 * Build the per-faction prompt. Mirrors OpenClaw's faction skill input:
 * world, character, faction body, on-stage entities, recent journal,
 * the player input. The faction agent returns { decision, reasoning }.
 */
export function buildFactionDossier(input: BuildFactionDossierInput): string {
  return [
    `<world calendar="${esc(input.world.calendar)}" date="${esc(input.world.date)}">`,
    renderWorld(input.world),
    `</world>`,
    `<character>`,
    renderCharacter(input.character),
    `</character>`,
    `<faction slug="${esc(input.faction.slug)}">`,
    input.faction.body.trim(),
    `</faction>`,
    `<on_stage>`,
    renderOnStage(input.onStage),
    `</on_stage>`,
    `<recent_journal>`,
    renderJournal(input.recent),
    `</recent_journal>`,
    `<player_input>${input.playerInput.trim()}</player_input>`,
  ].join('\n');
}

/**
 * Build the narrator prompt. Adds threads, style guide, and the faction
 * decisions returned by Step 2 of the workflow.
 */
export function buildNarratorDossier(input: BuildNarratorDossierInput): string {
  return [
    `<turn id="${esc(input.turnId)}">`,
    `<world calendar="${esc(input.world.calendar)}" date="${esc(input.world.date)}">`,
    renderWorld(input.world),
    `</world>`,
    `<character>`,
    renderCharacter(input.character),
    `</character>`,
    `<threads>`,
    renderThreads(input.threads),
    `</threads>`,
    `<style_guide>${input.styleGuide.trim()}</style_guide>`,
    `<on_stage>`,
    renderOnStage(input.onStage),
    `</on_stage>`,
    `<recent_journal>`,
    renderJournal(input.recent),
    `</recent_journal>`,
    `<faction_decisions>${renderDecisions(input.factionDecisions)}</faction_decisions>`,
    `<player_input>${input.playerInput.trim()}</player_input>`,
    `</turn>`,
  ].join('\n');
}

/**
 * Build the loremaster prompt. Used by the OOC fork (runAsk). No on-stage
 * detection, no faction fan-out — the loremaster gets the full always-loaded
 * world + character + threads + faction bodies + recent journal, then answers
 * the player's meta question in plain prose.
 */
export function buildLoremasterDossier(input: BuildLoremasterDossierInput): string {
  return [
    `<world calendar="${esc(input.world.calendar)}" date="${esc(input.world.date)}">`,
    renderWorld(input.world),
    `</world>`,
    `<character>`,
    renderCharacter(input.character),
    `</character>`,
    `<threads>`,
    renderThreads(input.threads),
    `</threads>`,
    `<factions>`,
    renderFactions(input.factions),
    `</factions>`,
    `<recent_journal>`,
    renderJournal(input.recent),
    `</recent_journal>`,
    `<ooc_question>${input.playerInput.trim()}</ooc_question>`,
  ].join('\n');
}

/**
 * Build the illustrator prompt: the ## Visual block, the narrator's prose,
 * and the on-stage entities (so the illustrator can pick at most a few
 * scenes and embed them as ![[file.png]] using the image tool).
 */
export function buildIllustratorDossier(input: BuildIllustratorDossierInput): string {
  return [
    `<visual_style>${input.styleGuideVisual.trim()}</visual_style>`,
    `<narrator_prose>${input.narratorProse.trim()}</narrator_prose>`,
    `<on_stage>`,
    renderOnStage(input.onStage),
    `</on_stage>`,
  ].join('\n');
}

// ---- private renderers ---------------------------------------------------

function renderWorld(w: WorldView): string {
  const lines = [
    `  <region>${esc(w.region)}</region>`,
    `  <city>${esc(w.city)}</city>`,
    `  <place slug="${esc(w.placeSlug)}"></place>`,
    `  <weather>${esc(w.weather)}</weather>`,
    `  <season>${esc(w.season)}</season>`,
  ];
  for (const note of w.notes) lines.push(`  <note>${esc(note)}</note>`);
  return lines.join('\n');
}

function renderCharacter(c: CharacterView): string {
  const lines = [
    `  <name>${esc(c.name)}</name>`,
    `  <age>${esc(c.age)}</age>`,
    `  <role>${esc(c.role)}</role>`,
    `  <background>${esc(c.background)}</background>`,
    `  <skills>${esc(c.skills)}</skills>`,
    `  <wealth>${esc(c.wealth)}</wealth>`,
  ];
  for (const item of c.inventory) {
    lines.push(`  <item significance="${esc(item.significance)}">${esc(item.text)}</item>`);
  }
  for (const r of c.reputation) {
    lines.push(`  <reputation slug="${esc(r.slug)}">${esc(r.text)}</reputation>`);
  }
  for (const rel of c.relationships) {
    lines.push(`  <relationship slug="${esc(rel.slug)}">${esc(rel.text)}</relationship>`);
  }
  return lines.join('\n');
}

function renderThreads(threads: ThreadView[]): string {
  return threads
    .map(
      (t) =>
        `  <thread id="${esc(t.id)}"><name>${esc(t.name)}</name><progress>${esc(t.progress)}</progress><stake>${esc(t.stake)}</stake></thread>`,
    )
    .join('\n');
}

function renderFactions(factions: EntityDoc[]): string {
  // Same reasoning as renderOnStage: bodies stay raw markdown for LLM
  // consumption; only the slug attribute is escaped.
  return factions
    .map((f) => `  <faction slug="${esc(f.slug)}">${f.body.trim()}</faction>`)
    .join('\n');
}

function renderOnStage(on: OnStage): string {
  const lines: string[] = [];
  for (const n of on.npcs) {
    const f =
      typeof n.frontmatter.faction === 'string' ? ` faction="${esc(n.frontmatter.faction)}"` : '';
    // NOTE: we intentionally do NOT esc() the markdown body. Bodies routinely
    // contain wikilinks `[[…]]` (XML-safe) and the LLM reads them as markdown;
    // running them through esc() would mangle stray `<` / `>` from prose into
    // `&lt;` / `&gt;` and degrade narration quality. Attribute values
    // (slug, faction) ARE escaped because they sit inside double quotes.
    lines.push(`  <npc slug="${esc(n.slug)}"${f}>${n.body.trim()}</npc>`);
  }
  for (const l of on.locations) {
    // Same reasoning as above: body stays raw markdown; the slug attribute is escaped.
    lines.push(`  <location slug="${esc(l.slug)}">${l.body.trim()}</location>`);
  }
  return lines.join('\n');
}

function renderJournal(recent: JournalEntry[]): string {
  // Same reasoning as renderOnStage: journal bodies are markdown that the LLM
  // reads directly — leave raw. Only the `heading` attribute (inside quotes)
  // is escaped.
  return recent
    .map((e) => `  <entry heading="${esc(e.heading)}">${e.body.trim()}</entry>`)
    .join('\n');
}

function renderDecisions(decisions: { slug: string; decision: string }[]): string {
  if (decisions.length === 0) return '';
  // Decision text is short narrator-facing prose — leave raw; only the slug
  // attribute (inside quotes) is escaped.
  return (
    '\n' +
    decisions
      .map((d) => `  <decision faction="${esc(d.slug)}">${d.decision.trim()}</decision>`)
      .join('\n') +
    '\n'
  );
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
