import matter from 'gray-matter';

export type Frontmatter = Record<string, unknown>;

export interface ParsedDoc {
  frontmatter: Frontmatter;
  /** Body content with the frontmatter block stripped. */
  body: string;
}

export class FrontmatterParseError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'FrontmatterParseError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/**
 * Parse YAML frontmatter from a Markdown string. Returns `{ frontmatter, body }`.
 * Missing frontmatter returns `frontmatter: {}` and the original string as `body`.
 * Malformed YAML throws `FrontmatterParseError`.
 */
export function parseFrontmatter(raw: string): ParsedDoc {
  try {
    const parsed = matter(raw);
    return {
      frontmatter: (parsed.data ?? {}) as Frontmatter,
      body: parsed.content,
    };
  } catch (err) {
    throw new FrontmatterParseError(
      err instanceof Error ? err.message : 'frontmatter parse failed',
      err,
    );
  }
}
