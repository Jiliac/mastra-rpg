// src/app/page.tsx
//
// Root landing — redirects to the configured campaign's play page if
// VAULT_SLUG is set, otherwise renders a one-line "no campaign configured"
// fallback. Replaces the create-next-app default. Per the spec's
// "Out-of-band cleanup" section (lines 601-605).

import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function Home() {
  const slug = process.env.VAULT_SLUG;
  if (slug && slug.trim().length > 0) {
    redirect(`/play/${encodeURIComponent(slug)}`);
  }
  return (
    <main className="flex h-screen w-full flex-col items-center justify-center gap-3 p-8">
      <h1 className="font-semibold text-2xl">mastra-rpg</h1>
      <p className="text-muted-foreground text-sm">
        No campaign configured. Set <code>VAULT_SLUG</code> in <code>.env.local</code> and reload.
      </p>
    </main>
  );
}
