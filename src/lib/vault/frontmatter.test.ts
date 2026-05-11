import { describe, it, expect } from 'vitest';
import { parseFrontmatter, FrontmatterParseError } from './frontmatter';

describe('frontmatter', () => {
  it('parses a YAML block with mixed scalars and arrays', () => {
    const raw = `---
aliases: [Foo, the foo]
tags: [npc, test]
faction: red-banner
goals:
  - first goal
  - second goal
---

Body text.`;
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({
      aliases: ['Foo', 'the foo'],
      tags: ['npc', 'test'],
      faction: 'red-banner',
      goals: ['first goal', 'second goal'],
    });
    expect(body.trim()).toBe('Body text.');
  });

  it('preserves array order and types', () => {
    const raw = `---
aliases: [a, b, c]
---

x`;
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.aliases).toEqual(['a', 'b', 'c']);
  });

  it('returns empty frontmatter when block is absent', () => {
    const raw = '# No frontmatter here\n\nBody.';
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({});
    expect(body).toBe(raw);
  });

  it('returns missing fields as undefined (not throwing)', () => {
    const raw = `---
tags: [npc]
---

x`;
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.tags).toEqual(['npc']);
    expect((frontmatter as Record<string, unknown>).faction).toBeUndefined();
  });

  it('throws FrontmatterParseError on malformed YAML', () => {
    const raw = `---
tags: [unclosed
---

x`;
    expect(() => parseFrontmatter(raw)).toThrow(FrontmatterParseError);
  });

  it('FrontmatterParseError supports an undefined cause (no-cause constructor branch)', () => {
    const e = new FrontmatterParseError('boom');
    expect(e.name).toBe('FrontmatterParseError');
    expect(e.message).toBe('boom');
    expect((e as { cause?: unknown }).cause).toBeUndefined();
  });
});
