import { Suspense } from "react";

import { DiscoveryHeader, RentBuyToggle } from "./../_components/discovery-header";
import { SearchPill } from "./../_components/search-pill";
import { DiscoverySplitView } from "./../_components/discovery-split-view";
import { DiscoveryFallbackNotice } from "./../_components/discovery-fallback-notice";
import type { PublicListing } from "./../_components/discovery-listing-card";
import { DISCOVERY_PATH } from "./../_components/discovery-path";

// Discovery Hub at /homes — the Figma "Default State" build: branded
// header row (logo + List-your-property CTA + menu), centered Rent/Buy
// toggle above the search pill, results-count + filter row above the
// grid, split-pane map + listing grid below.
//
// Server-rendered for SEO — real HTML on first paint, real fetch
// server-side — with the same anonymous fetch (no Authorization
// header) and 60s revalidation. `city`/`max_price` are forwarded to
// the backend; `listing_type` is deliberately NOT (no such backend
// param) — DiscoverySplitView filters the fetched rows in the browser
// instead. `filters=open` shows the amenity-chip row (Figma "Filter
// Expanded"); picked chips arrive here as `amenities` and are forwarded.

type SearchParams = Promise<{
  city?: string;
  max_price?: string;
  advance_rent_period?: string;
  listing_type?: string;
  amenities?: string | string[];
}>;

async function fetchListings(searchParams: Awaited<SearchParams>) {
  // Filter-row amenity chips (?amenities=wifi&amenities=pool) — the
  // backend keeps listings having ANY of them. Kept on the city
  // fallback too, like advance period and price cap.
  const amenities = [searchParams.amenities ?? []].flat();
  function withAmenities(params: URLSearchParams) {
    amenities.forEach((slug) => params.append("amenities", slug));
    return params;
  }

  const filteredParams = new URLSearchParams();
  if (searchParams.city) filteredParams.set("city", searchParams.city);
  if (searchParams.advance_rent_period)
    filteredParams.set("advance_rent_period", searchParams.advance_rent_period);
  if (searchParams.max_price)
    filteredParams.set("max_price", searchParams.max_price);

  async function get(params: URLSearchParams): Promise<PublicListing[]> {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/listings/?${params.toString()}`,
      {
        next: { revalidate: 60 },
      },
    );

    if (!res.ok) return [];
    const data = await res.json();
    return (Array.isArray(data) ? data : (data.results ?? [])) as PublicListing[];
  }

  const filtered = await get(withAmenities(filteredParams));
  if (filtered.length > 0 || !searchParams.city) {
    return { listings: filtered, cityFallback: false };
  }

  // City miss (e.g. a full "Osu, Accra, Ghana" pick against the
  // backend's exact city match, or somewhere with no listings like
  // New Zealand): fall back to the city-unfiltered list at the same
  // advance period and price cap so the grid never wipes. A
  // price/advance-only miss stays a genuine empty state.
  const fallbackParams = new URLSearchParams();
  if (searchParams.advance_rent_period)
    fallbackParams.set("advance_rent_period", searchParams.advance_rent_period);
  if (searchParams.max_price)
    fallbackParams.set("max_price", searchParams.max_price);
  return { listings: await get(withAmenities(fallbackParams)), cityFallback: true };
}

export default async function HomesHubPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const { listings, cityFallback } = await fetchListings(params);
  // Server-read toggle value (client-filtered downstream — no backend
  // param exists). Anything but rent/buy → unfiltered.
  const rawType = params.listing_type;
  const listingType =
    rawType === "rent" || rawType === "buy" ? rawType : undefined;

  return (
    <div className="flex h-svh flex-col overflow-hidden">
      <header className="shrink-0 border-b p-3 md:p-4">
        <div className="mx-auto max-w-6xl space-y-3 md:space-y-4">
          <DiscoveryHeader />
          <div className="flex flex-col items-center justify-center">
            <Suspense fallback={<div className="h-9" />}>
              <RentBuyToggle />
            </Suspense>
          <Suspense fallback={<div className="h-12" />}>
            <SearchPill basePath={DISCOVERY_PATH} />
          </Suspense>
          </div>
        </div>
      </header>

      {/* No key-remount on toggle flips: the split view re-seeds its
          own client state via an effect on listingType, so the map
          (and its InfoWindow React root) stays mounted. */}
      <DiscoverySplitView
        listings={listings}
        listingType={listingType}
        focusLocation={params.city ?? null}
        city={params.city}
        notice={
          cityFallback && params.city ? (
            <DiscoveryFallbackNotice city={params.city} />
          ) : undefined
        }
      />
    </div>
  );
}
