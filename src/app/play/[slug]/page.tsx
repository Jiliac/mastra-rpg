// src/app/play/[slug]/page.tsx
//
// Server component. Awaits the Next-16 params Promise and forwards the
// slug to the client component, which owns all the SSE + UI state.

import { PlayClient } from './play-client';

export const dynamic = 'force-dynamic';

export default async function PlayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PlayClient slug={slug} />;
}
