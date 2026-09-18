// Discovery Hub — the public, SEO-facing landing page (AGENTS.md
// build-priority #1: split-pane map + listing grid, search pill).
// A real SERVER component (no "use client") specifically so this
// initial listing fetch happens server-side and search engines/first
// paint get real HTML, not an empty shell waiting on a client fetch —
// per AGENTS.md's explicit reasoning for keeping public discovery
// pages server-rendered.
//
// Data fetching here is a PLAIN fetch(), not Refine's dataProvider —
// Refine's hooks (useList, etc.) are client-side by construction, and
// pulling one into a server component isn't how Refine is meant to be
// used. This mirrors (admin)/layout.tsx's and dashboard/page.tsx's
// own pattern of a direct fetch() for server-side reads, just against
// the now-public GET /listings/ (confirmed anonymous-accessible via a
// direct curl against the live backend, and via backend/listings/
// views.py on main: ListingViewSet.get_permissions() opens list/
// retrieve to AllowAny).

import { Suspense } from "react";
import { SearchPill } from "./_components/search-pill";
import { DiscoverySplitView } from "./_components/discovery-split-view";
import type { PublicListing } from "./_components/discovery-listing-card";

type SearchParams = Promise<{ city?: string; max_price?: string }>;

async function fetchListings(searchParams: Awaited<SearchParams>) {
  const params = new URLSearchParams();
  if (searchParams.city) params.set("city", searchParams.city);
  if (searchParams.max_price) params.set("max_price", searchParams.max_price);

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/listings/?${params.toString()}`,
    // No Authorization header at all — deliberately anonymous, this
    // page must render identically for a logged-out visitor and a
    // search crawler, which is the entire point of it being public.
    {
      next: { revalidate: 60 },
      // Revalidate every 60s rather than no-store — listings don't
      // change every second, and full no-store here would mean every
      // single visitor (and crawler hit) triggers a fresh backend
      // round-trip, unnecessary load for a page whose data is this
      // slow-moving.
    },
  );

  if (!res.ok) return [] as PublicListing[];

  const data = await res.json();
  // Handles both a plain array (matches what the backend actually
  // returns for an empty result — confirmed via curl: `[]`, not
  // `{results: []}`) and a paginated {results: [...]} shape, in case
  // DRF pagination gets enabled on this endpoint later.
  return (Array.isArray(data) ? data : (data.results ?? [])) as PublicListing[];
}

export default async function DiscoveryHubPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const listings = await fetchListings(params);

  return (
    <div className="flex h-svh flex-col overflow-hidden">
      <header className="shrink-0 border-b p-4">
        <div className="mx-auto max-w-6xl space-y-4">
          <h1 className="text-center text-2xl font-bold">paddy</h1>
          <Suspense fallback={<div className="h-12" />}>
            <SearchPill />
          </Suspense>
        </div>
      </header>

      <DiscoverySplitView listings={listings} />
    </div>
  );
}
