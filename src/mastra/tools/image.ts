import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { generateImage } from '@/lib/media/image';
import { vaultRoot } from '@/lib/vault/paths';
// NOTE: `@/lib/schemas` exports `ImageMeta` as BOTH a Zod schema (runtime value)
// AND a TS type alias (`z.infer<typeof ImageMeta>`) under the same name. This
// dual export pattern is fragile — `import { ImageMeta }` here resolves to the
// runtime value (the Zod schema), which is what `outputSchema` needs. The
// `Promise<ImageMeta>` return type below resolves to the type alias via TS's
// type-vs-value namespace separation. Keep both usages consistent: type
// positions get the type, value positions (outputSchema, runtime checks) get
// the Zod schema.
import { ImageMeta } from '@/lib/schemas';

/**
 * Thin adapter over `src/lib/media/image.ts`. The illustrator calls this
 * 0-3 times per turn; the workflow runs them in the illustrator's tool loop.
 *
 * Vault root: defaults to `vaultRoot(process.env.VAULT_SLUG)`. Tests
 * override via `deps.vaultRoot`; `deps.generateImage` is the SDK seam.
 */
export interface ImageInput {
  prompt: string;
  slug: string;
}

export interface ImageDeps {
  vaultRoot?: string;
  generateImage?: typeof generateImage;
}

function resolveRoot(deps?: ImageDeps): string {
  if (deps?.vaultRoot) return deps.vaultRoot;
  const slug = process.env.VAULT_SLUG;
  if (!slug) {
    throw new Error('image: VAULT_SLUG env var is unset (and no deps.vaultRoot provided)');
  }
  return vaultRoot(slug);
}

export async function imageImpl(input: ImageInput, deps?: ImageDeps): Promise<ImageMeta> {
  const root = resolveRoot(deps);
  const gen = deps?.generateImage ?? generateImage;
  return gen({ prompt: input.prompt, slug: input.slug, vaultRoot: root });
}

export const imageTool = createTool({
  id: 'image',
  description:
    'Generate an image (gpt-image-2, quality=high) and write it under <vault>/images/. ' +
    'Returns { filename, path, prompt, slug }. The illustrator uses `filename` to embed the image in prose as `![[filename.png]]`.',
  inputSchema: z.object({
    prompt: z
      .string()
      .min(1)
      .describe(
        'The image prompt. The vault style-guide ## Visual block is prepended upstream by the illustrator before calling this tool.',
      ),
    slug: z
      .string()
      .min(1)
      .describe('A short kebab-case slug used in the filename (e.g. "kessha-helm").'),
  }),
  outputSchema: ImageMeta,
  execute: async (inputData) => imageImpl(inputData),
});
