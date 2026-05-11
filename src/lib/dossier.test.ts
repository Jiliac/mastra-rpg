import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  extractVisualBlock,
  identifyOnStage,
  buildFactionDossier,
  buildNarratorDossier,
  buildIllustratorDossier,
  type OnStage,
} from './dossier';
import type { EntityDoc } from './vault/entities';
import type { WorldView, CharacterView, ThreadView } from './vault/xml';
import type { JournalEntry } from './vault/journal';

const FIXTURE = 'tests/fixtures/test-vault';

// ---- shared fixture builders ---------------------------------------------

function world(): WorldView {
  return {
    date: '7 ABY, Month 4, Standard Day 20',
    calendar: 'GSC',
    region: 'Test Region',
    city: 'Test City',
    placeSlug: 'iron-promise',
    weather: 'Clear, cold.',
    season: 'Test season.',
    notes: ['A test note.'],
  };
}

function character(): CharacterView {
  return {
    name: 'Test Captain',
    age: '40',
    role: 'test captain',
    background: 'A test background.',
    skills: 'Test skills.',
    inventory: [{ significance: 'key', text: 'Test item' }],
    wealth: 'strapped',
    reputation: [{ slug: 'red-banner', text: 'tolerated' }],
    relationships: [{ slug: 'kessha', text: 'first mate' }],
  };
}

function threads(): ThreadView[] {
  return [{ id: 'fresh-clock', name: 'Fresh Clock', stake: 's', progress: '1/8', trigger: 't' }];
}

function kessha(): EntityDoc {
  return {
    slug: 'kessha',
    frontmatter: { aliases: ['Kessha', 'the navigator'], tags: ['npc'], faction: 'red-banner' },
    body: '# Kessha\n\nNavigator and aide.',
  };
}

function loneWolf(): EntityDoc {
  return {
    slug: 'lone-wolf',
    frontmatter: { aliases: ['Lone Wolf'], tags: ['npc'] },
    body: '# Lone Wolf\n\nUnaffiliated.',
  };
}

function ironPromise(): EntityDoc {
  return {
    slug: 'iron-promise',
    frontmatter: { aliases: ['the ship'], tags: ['location'] },
    body: '# Iron Promise\n\nA ship.',
  };
}

function redBanner(): EntityDoc {
  return {
    slug: 'red-banner',
    frontmatter: { aliases: ['Red Banner'], tags: ['faction'] },
    body: '# Red Banner\n\nA syndicate.',
  };
}

function recentJournal(): JournalEntry[] {
  return [
    {
      heading: '7 ABY, Month 4, Standard Day 18 — turn-001',
      body: 'Turn-001 prose mentions [[npcs/kessha|Kessha]] and [[locations/iron-promise]].',
    },
    {
      heading: 'Turn 002 - 7 ABY, Month 4, Day 19',
      body: 'Quiet beat.',
    },
  ];
}

// ---- extractVisualBlock --------------------------------------------------

describe('extractVisualBlock', () => {
  it('returns the body of ## Visual from the fixture style-guide', async () => {
    const raw = await fs.readFile(path.join(FIXTURE, 'style-guide.md'), 'utf8');
    const block = extractVisualBlock(raw);
    expect(block).toBe('Test visual block. One sentence.');
  });

  it('returns null when ## Visual is missing', () => {
    expect(extractVisualBlock('# Style Guide\n\n## Tone\n\nOnly tone.\n')).toBeNull();
  });

  it('captures up to the next ## heading', () => {
    const src = '# x\n\n## Visual\n\nFirst block.\nSecond line.\n\n## After\n\nIgnored.';
    expect(extractVisualBlock(src)).toBe('First block.\nSecond line.');
  });

  it('captures up to EOF when no following ## heading exists', () => {
    const src = '# x\n\n## Visual\n\nOnly block.\nMultiple lines.';
    expect(extractVisualBlock(src)).toBe('Only block.\nMultiple lines.');
  });
});

// ---- identifyOnStage -----------------------------------------------------

describe('identifyOnStage', () => {
  it('flags an NPC mentioned in the player input by alias', () => {
    const out = identifyOnStage({
      playerInput: 'I greet Kessha at the gangway.',
      recent: [],
      entities: [kessha(), loneWolf(), ironPromise()],
    });
    expect(out.npcs.map((n) => n.slug)).toEqual(['kessha']);
    expect(out.factionsToSpawn).toEqual(['red-banner']);
  });

  it('flags an NPC mentioned in recent journal via folder-prefixed wikilink', () => {
    const out = identifyOnStage({
      playerInput: 'I look around.',
      recent: recentJournal(),
      entities: [kessha(), loneWolf(), ironPromise()],
    });
    expect(out.npcs.map((n) => n.slug)).toContain('kessha');
    expect(out.factionsToSpawn).toEqual(['red-banner']);
  });

  it('does NOT spawn a faction for an on-stage NPC without faction frontmatter', () => {
    const out = identifyOnStage({
      playerInput: 'Lone Wolf nods.',
      recent: [],
      entities: [loneWolf()],
    });
    expect(out.npcs.map((n) => n.slug)).toEqual(['lone-wolf']);
    expect(out.factionsToSpawn).toEqual([]);
  });

  it('dedupes factions when two on-stage NPCs share a faction', () => {
    const otherRedNpc: EntityDoc = {
      slug: 'red-second',
      frontmatter: { aliases: ['Red Two'], tags: ['npc'], faction: 'red-banner' },
      body: '',
    };
    const out = identifyOnStage({
      playerInput: 'Kessha and Red Two are here.',
      recent: [],
      entities: [kessha(), otherRedNpc],
    });
    expect(out.npcs.map((n) => n.slug).sort()).toEqual(['kessha', 'red-second']);
    expect(out.factionsToSpawn).toEqual(['red-banner']);
  });

  it('returns locations separately from npcs', () => {
    const out = identifyOnStage({
      playerInput: 'I board the [[locations/iron-promise]].',
      recent: [],
      entities: [kessha(), ironPromise()],
    });
    expect(out.locations.map((l) => l.slug)).toEqual(['iron-promise']);
    expect(out.npcs).toEqual([]);
    expect(out.factionsToSpawn).toEqual([]);
  });

  it('returns empty arrays for a "player is alone" beat', () => {
    const out: OnStage = identifyOnStage({
      playerInput: 'I sit and think.',
      recent: [{ heading: 'h', body: 'nothing here' }],
      entities: [kessha(), loneWolf(), ironPromise()],
    });
    expect(out.npcs).toEqual([]);
    expect(out.locations).toEqual([]);
    expect(out.factionsToSpawn).toEqual([]);
  });

  it('matches alias case-insensitively (kessha ≠ KESSHA in user input)', () => {
    const out = identifyOnStage({
      playerInput: 'KESSHA is here.',
      recent: [],
      entities: [kessha()],
    });
    expect(out.npcs.map((n) => n.slug)).toEqual(['kessha']);
  });
});

// ---- buildFactionDossier -------------------------------------------------

describe('buildFactionDossier', () => {
  it('renders the full faction prompt with all required sections', () => {
    const out = identifyOnStage({
      playerInput: 'I greet Kessha.',
      recent: [],
      entities: [kessha(), loneWolf()],
    });
    const dossier = buildFactionDossier({
      faction: redBanner(),
      onStage: out,
      recent: recentJournal(),
      world: world(),
      character: character(),
      playerInput: 'I greet Kessha.',
    });
    expect(dossier).toContain('<world');
    expect(dossier).toContain('7 ABY, Month 4, Standard Day 20');
    expect(dossier).toContain('<character>');
    expect(dossier).toContain('Test Captain');
    expect(dossier).toContain('<faction slug="red-banner">');
    expect(dossier).toContain('Red Banner');
    expect(dossier).toContain('<on_stage>');
    expect(dossier).toContain('kessha');
    expect(dossier).toContain('<recent_journal>');
    expect(dossier).toContain('Turn-001 prose mentions');
    expect(dossier).toContain('<player_input>');
    expect(dossier).toContain('I greet Kessha.');
  });

  it('returns the same string for the same inputs (value-equality of deterministic output)', () => {
    const a = buildFactionDossier({
      faction: redBanner(),
      onStage: { npcs: [], locations: [], factionsToSpawn: [] },
      recent: [],
      world: world(),
      character: character(),
      playerInput: 'x',
    });
    const b = buildFactionDossier({
      faction: redBanner(),
      onStage: { npcs: [], locations: [], factionsToSpawn: [] },
      recent: [],
      world: world(),
      character: character(),
      playerInput: 'x',
    });
    expect(a).toBe(b);
  });
});

// ---- buildNarratorDossier ------------------------------------------------

describe('buildNarratorDossier', () => {
  it('renders narrator-specific sections including faction_decisions', () => {
    const dossier = buildNarratorDossier({
      world: world(),
      character: character(),
      threads: threads(),
      styleGuide: '# Style Guide\n\n## Tone\n\nClipped.\n',
      onStage: {
        npcs: [kessha()],
        locations: [ironPromise()],
        factionsToSpawn: ['red-banner'],
      },
      recent: recentJournal(),
      factionDecisions: [{ slug: 'red-banner', decision: 'Send envoys.' }],
      playerInput: 'I greet Kessha.',
      turnId: 'turn-042',
    });
    expect(dossier).toContain('<world');
    expect(dossier).toContain('<character>');
    expect(dossier).toContain('<threads>');
    expect(dossier).toContain('fresh-clock');
    expect(dossier).toContain('<style_guide>');
    expect(dossier).toContain('Clipped.');
    expect(dossier).toContain('<on_stage>');
    expect(dossier).toContain('kessha');
    expect(dossier).toContain('<recent_journal>');
    expect(dossier).toContain('<faction_decisions>');
    expect(dossier).toContain('Send envoys.');
    expect(dossier).toContain('<player_input>');
    expect(dossier).toContain('I greet Kessha.');
    expect(dossier).toContain('turn-042');
  });

  it('handles empty faction_decisions cleanly (the alone case)', () => {
    const dossier = buildNarratorDossier({
      world: world(),
      character: character(),
      threads: [],
      styleGuide: '',
      onStage: { npcs: [], locations: [], factionsToSpawn: [] },
      recent: [],
      factionDecisions: [],
      playerInput: 'I sit alone.',
      turnId: 'turn-001',
    });
    expect(dossier).toContain('<faction_decisions></faction_decisions>');
    expect(dossier).toContain('I sit alone.');
  });
});

// ---- buildIllustratorDossier ---------------------------------------------

describe('buildIllustratorDossier', () => {
  it('embeds the visual block + prose + on-stage entities', () => {
    const dossier = buildIllustratorDossier({
      narratorProse: 'The harbor wind carries the smell of pitch.',
      styleGuideVisual: 'Test visual block. One sentence.',
      onStage: {
        npcs: [kessha()],
        locations: [ironPromise()],
        factionsToSpawn: ['red-banner'],
      },
    });
    expect(dossier).toContain('<visual_style>');
    expect(dossier).toContain('Test visual block.');
    expect(dossier).toContain('<narrator_prose>');
    expect(dossier).toContain('harbor wind');
    expect(dossier).toContain('<on_stage>');
    expect(dossier).toContain('kessha');
    expect(dossier).toContain('iron-promise');
  });

  it('omits <visual_style> contents when style guide had no ## Visual block', () => {
    const dossier = buildIllustratorDossier({
      narratorProse: 'X.',
      styleGuideVisual: '',
      onStage: { npcs: [], locations: [], factionsToSpawn: [] },
    });
    expect(dossier).toContain('<visual_style></visual_style>');
  });
});
