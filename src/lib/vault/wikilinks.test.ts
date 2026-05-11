import { describe, it, expect } from 'vitest';
import { parseWikilinks, resolveWikilink, stripForTts, type AliasRegistry } from './wikilinks';

const REGISTRY: AliasRegistry = {
  npcs: new Set(['kessha', 'iron-promise-captain', 'lone-wolf']),
  locations: new Set(['iron-promise', 'the-brace']),
  factions: new Set(['red-banner', 'blue-river']),
};

describe('parseWikilinks', () => {
  it('extracts a folder-prefixed link', () => {
    const links = parseWikilinks('See [[npcs/kessha]] for details.');
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      raw: '[[npcs/kessha]]',
      target: 'npcs/kessha',
      alias: undefined,
      embed: false,
    });
  });

  it('extracts a folder-prefixed link with alias', () => {
    const links = parseWikilinks('Hello [[npcs/kessha|Kessha]], goodbye.');
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      raw: '[[npcs/kessha|Kessha]]',
      target: 'npcs/kessha',
      alias: 'Kessha',
      embed: false,
    });
  });

  it('extracts a bare link', () => {
    const links = parseWikilinks('See [[Foo]].');
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      raw: '[[Foo]]',
      target: 'Foo',
      alias: undefined,
      embed: false,
    });
  });

  it('flags image embeds with embed: true', () => {
    const links = parseWikilinks('Picture: ![[image.png]] caption.');
    expect(links[0]).toEqual({
      raw: '![[image.png]]',
      target: 'image.png',
      alias: undefined,
      embed: true,
    });
  });

  it('extracts multiple links in one pass and preserves order', () => {
    const links = parseWikilinks(
      '[[Foo]] then [[npcs/kessha|K]] and ![[img.png]] and [[locations/the-brace]].',
    );
    expect(links.map((l) => l.target)).toEqual([
      'Foo',
      'npcs/kessha',
      'img.png',
      'locations/the-brace',
    ]);
    expect(links.map((l) => l.embed)).toEqual([false, false, true, false]);
  });

  it('returns empty array when there are no links', () => {
    expect(parseWikilinks('No links here at all.')).toEqual([]);
  });
});

describe('resolveWikilink', () => {
  it('folder-prefix wins: [[npcs/kessha]] resolves as npc/kessha', () => {
    const r = resolveWikilink({ target: 'npcs/kessha', embed: false }, REGISTRY);
    expect(r).toEqual({ kind: 'npc', slug: 'kessha', found: true });
  });

  it('folder-prefix [[locations/iron-promise]] resolves as location', () => {
    const r = resolveWikilink({ target: 'locations/iron-promise', embed: false }, REGISTRY);
    expect(r).toEqual({ kind: 'location', slug: 'iron-promise', found: true });
  });

  it('folder-prefix [[factions/red-banner]] resolves as faction', () => {
    const r = resolveWikilink({ target: 'factions/red-banner', embed: false }, REGISTRY);
    expect(r).toEqual({ kind: 'faction', slug: 'red-banner', found: true });
  });

  it('folder-prefix overrides alias-only match', () => {
    // "kessha" exists as an NPC; if the player wrote [[locations/kessha]] we trust the prefix
    // and report not-found rather than silently routing to npcs/kessha.
    const r = resolveWikilink({ target: 'locations/kessha', embed: false }, REGISTRY);
    expect(r).toEqual({ kind: 'location', slug: 'kessha', found: false });
  });

  it('bare link defaults to kind=npc, found=false (no alias lookup in v0)', () => {
    const r = resolveWikilink({ target: 'Some Unknown', embed: false }, REGISTRY);
    expect(r).toEqual({ kind: 'npc', slug: 'some-unknown', found: false });
  });

  it('bare link slugifies a multi-word target with simple lower+dash rule', () => {
    const r = resolveWikilink({ target: 'A New Captain', embed: false }, REGISTRY);
    expect(r).toEqual({ kind: 'npc', slug: 'a-new-captain', found: false });
  });

  it('bare link even with a known display name does NOT resolve in v0', () => {
    // "Kessha" exists as an NPC alias on disk, but v0 requires folder-prefix.
    // Bare [[Kessha]] becomes a stub candidate. This is documented behavior.
    const r = resolveWikilink({ target: 'Kessha', embed: false }, REGISTRY);
    expect(r).toEqual({ kind: 'npc', slug: 'kessha', found: false });
  });

  it('image embeds resolve as kind=image with no slug normalization', () => {
    const r = resolveWikilink({ target: '2026-04-28-img.png', embed: true }, REGISTRY);
    expect(r).toEqual({ kind: 'image', slug: '2026-04-28-img.png', found: false });
  });

  it('unknown folder prefix falls back to bare-link npc-stub behavior', () => {
    // `widgets/` is not a known kind-folder; the resolver should slugify the whole target.
    const r = resolveWikilink({ target: 'widgets/Foo Bar', embed: false }, REGISTRY);
    expect(r).toEqual({ kind: 'npc', slug: 'widgets/foo-bar', found: false });
  });
});

describe('stripForTts', () => {
  it('alias wins: [[npcs/kessha|Kessha]] → "Kessha"', () => {
    expect(stripForTts('Hello [[npcs/kessha|Kessha]].')).toBe('Hello Kessha.');
  });

  it('no alias: [[npcs/kessha]] → "kessha" (single-token slug)', () => {
    expect(stripForTts('See [[npcs/kessha]].')).toBe('See kessha.');
  });

  it('no alias, multi-token slug: [[locations/iron-promise]] → "iron promise"', () => {
    expect(stripForTts('At [[locations/iron-promise]].')).toBe('At iron promise.');
  });

  it('bare link [[Foo]] emits the target verbatim', () => {
    expect(stripForTts('See [[Foo]].')).toBe('See Foo.');
  });

  it('image embeds are dropped entirely', () => {
    expect(stripForTts('Picture: ![[img.png]] caption.')).toBe('Picture:  caption.');
  });

  it('handles multiple links in one pass', () => {
    expect(
      stripForTts('[[npcs/kessha|Kessha]] and [[locations/iron-promise]] meet at [[the-brace]].'),
    ).toBe('Kessha and iron promise meet at the-brace.');
  });

  it('passes through plain text untouched', () => {
    expect(stripForTts('Plain text with no links.')).toBe('Plain text with no links.');
  });

  it('emits unknown-folder targets verbatim (no kind-folder boundary to strip)', () => {
    // `widgets/foo` isn't a known kind-folder; stripForTts treats it as bare.
    expect(stripForTts('See [[widgets/foo-bar]].')).toBe('See widgets/foo-bar.');
  });

  it('empty alias falls through to deslug rather than disappearing the link', () => {
    expect(stripForTts('See [[npcs/iron-promise-captain|]].')).toBe('See iron promise captain.');
  });

  it('whitespace-only alias is treated as empty and falls through', () => {
    expect(stripForTts('See [[npcs/kessha|   ]].')).toBe('See kessha.');
  });
});
