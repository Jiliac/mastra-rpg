import { z } from 'zod';

/**
 * Output schemas for the three agents and the per-image record they produce.
 * Spec lines 143-172. These are the I/O contracts between the workflow
 * (src/mastra/workflows/turn.ts, Wave 5) and the agents (Wave 4); also
 * consumed by the SSE serializer in src/app/api/turn/route.ts (Wave 6).
 *
 * Inferred TypeScript types are re-exported so callers can write
 *   import type { NarratorOutput } from '@/lib/schemas';
 * without invoking `z.infer<typeof ...>` themselves.
 */

export const FactionOutput = z.object({
  decision: z.string().min(1),
  reasoning: z.string().min(1),
});
export type FactionOutput = z.infer<typeof FactionOutput>;

export const NarratorOutput = z.object({
  prose: z.string().min(1),
  time_passed: z
    .object({
      days: z.number().int().nonnegative().optional(),
      hours: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
export type NarratorOutput = z.infer<typeof NarratorOutput>;

export const ImageMeta = z.object({
  filename: z.string().min(1),
  path: z.string().min(1),
  prompt: z.string().min(1),
  slug: z.string().min(1),
});
export type ImageMeta = z.infer<typeof ImageMeta>;

export const IllustratorOutput = z.object({
  prose_with_embeds: z.string().min(1),
  images: z.array(ImageMeta),
});
export type IllustratorOutput = z.infer<typeof IllustratorOutput>;

export const ClassifierOutput = z.object({
  isOoc: z.boolean(),
  reasoning: z.string().min(1),
});
export type ClassifierOutput = z.infer<typeof ClassifierOutput>;
