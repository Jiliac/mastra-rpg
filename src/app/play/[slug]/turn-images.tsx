// src/app/play/[slug]/turn-images.tsx
'use client';

import type { ImageMeta } from '@/lib/schemas';

export function TurnImages({ slug, images }: { slug: string; images: ImageMeta[] }) {
  if (images.length === 0) return null;
  return (
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {images.map((img) => (
        <figure key={img.filename} className="overflow-hidden rounded-md border">
          {/* eslint-disable-next-line @next/next/no-img-element -- vault images live outside `public/` and are served via /api/turn/image; next/image's loader would 404. */}
          <img
            src={`/api/turn/image?slug=${encodeURIComponent(slug)}&filename=${encodeURIComponent(img.filename)}`}
            alt={img.prompt}
            className="h-auto w-full"
          />
          <figcaption className="bg-muted/30 px-2 py-1 text-muted-foreground text-xs">
            {img.slug}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
