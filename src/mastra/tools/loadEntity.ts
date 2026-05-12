import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  loadNpc as defaultLoadNpc,
  loadFaction as defaultLoadFaction,
  loadLocation as defaultLoadLocation,
  type EntityDoc,
} from '@/lib/vault/entities';
import { vaultRoot } from '@/lib/vault/paths';

/**
 * Read-only entity loader. Wraps the Wave-1 loaders; the file-missing case
 * returns `{ found: false }` instead of throwing so the agent can decide
 * whether to use a stub or skip (spec error matrix line 343). Any other
 * loader error (malformed YAML, missing frontmatter, FS permission, etc.)
 * is re-thrown so real bugs surface rather than masquerading as not-found.
 *
 * Vault root resolution: defaults to `vaultRoot(process.env.VAULT_SLUG)`.
 * Tests override via `deps.vaultRoot` (and optionally `deps.loaders`).
 */
export type EntityKind = 'npc' | 'faction' | 'location';

export interface LoadEntityInput {
  kind: EntityKind;
  slug: string;
}

export type EntityLoader = (root: string, slug: string) => Promise<EntityDoc>;

export interface LoadEntityDeps {
  vaultRoot?: string;
  /**
   * Override the kind→loader map. Only used by tests; production runs always
   * resolve to the Wave-1 `loadNpc` / `loadFaction` / `loadLocation`.
   */
  loaders?: Partial<Record<EntityKind, EntityLoader>>;
}

export type LoadEntityResult =
  | {
      found: true;
      kind: EntityKind;
      slug: string;
      frontmatter: Record<string, unknown>;
      body: string;
    }
  | { found: false; kind: EntityKind; slug: string; error: string };

function resolveRoot(deps?: LoadEntityDeps): string {
  if (deps?.vaultRoot) return deps.vaultRoot;
  const slug = process.env.VAULT_SLUG;
  if (!slug) {
    throw new Error('loadEntity: VAULT_SLUG env var is unset (and no deps.vaultRoot provided)');
  }
  return vaultRoot(slug);
}

export async function loadEntityImpl(
  input: LoadEntityInput,
  deps?: LoadEntityDeps,
): Promise<LoadEntityResult> {
  const root = resolveRoot(deps);
  const loadNpc = deps?.loaders?.npc ?? defaultLoadNpc;
  const loadFaction = deps?.loaders?.faction ?? defaultLoadFaction;
  const loadLocation = deps?.loaders?.location ?? defaultLoadLocation;
  try {
    const doc =
      input.kind === 'npc'
        ? await loadNpc(root, input.slug)
        : input.kind === 'faction'
          ? await loadFaction(root, input.slug)
          : await loadLocation(root, input.slug);
    return {
      found: true,
      kind: input.kind,
      slug: doc.slug,
      frontmatter: doc.frontmatter as Record<string, unknown>,
      body: doc.body,
    };
  } catch (err) {
    // Only the spec-defined missing-slug case (ENOENT) becomes { found: false }.
    // Malformed YAML, missing frontmatter, FS permission errors etc. must surface
    // as real exceptions so bugs don't hide behind a misleading "not found" shape.
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') {
      const msg = err instanceof Error ? err.message : String(err);
      return { found: false, kind: input.kind, slug: input.slug, error: msg };
    }
    throw err;
  }
}

const outputSchema = z.discriminatedUnion('found', [
  z.object({
    found: z.literal(true),
    kind: z.enum(['npc', 'faction', 'location']),
    slug: z.string(),
    frontmatter: z.record(z.string(), z.unknown()),
    body: z.string(),
  }),
  z.object({
    found: z.literal(false),
    kind: z.enum(['npc', 'faction', 'location']),
    slug: z.string(),
    error: z.string(),
  }),
]);

export const loadEntityTool = createTool({
  id: 'loadEntity',
  description:
    'Read a vault entity by kind + slug. Returns { found: true, kind, slug, frontmatter, body } ' +
    'on hit, or { found: false, kind, slug, error } on miss. Use when you need detail on ' +
    'a wikilink target that is not in the on-stage block.',
  inputSchema: z.object({
    kind: z.enum(['npc', 'faction', 'location']),
    slug: z.string().min(1),
  }),
  outputSchema,
  execute: async (inputData) => loadEntityImpl(inputData),
});
