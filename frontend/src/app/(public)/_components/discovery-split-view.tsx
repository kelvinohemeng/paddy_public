"use client";

import { useState } from "react";
import { DiscoveryMap } from "./discovery-map";
import { DiscoveryListingCard, type PublicListing } from "./discovery-listing-card";
import type { MapPlacePreview } from "./discovery-map";

type DiscoverySplitViewProps = {
  listings: PublicListing[];
  // Optional fixed header above the grid column (e.g. the /homes
  // results-count + filter row). Rendered outside the scrollable grid
  // so it stays put while cards scroll. Undefined → today's layout.
  gridHeader?: React.ReactNode;
  // Rent/Buy toggle value (see discovery-header.tsx), passed as a prop
  // — not read via useSearchParams — so this island stays
  // suspense-free in the server page that renders it. The backend has
  // no listing_type param, so it filters the already-fetched rows in
  // the browser. Undefined → no filtering, everything shows.
  listingType?: "rent" | "buy";
  // Server-read `city` query — forwarded to the map so a submitted
  // search pans/zooms there (see DiscoveryMap searchFocus).
  focusLocation?: string | null;
};

// Client island for the interactive half of the hub (hover-sync
// between grid cards and map markers) — the page itself stays a
// server component so the INITIAL listing fetch is real SSR (crawlers
// and first paint get real HTML, not an empty shell waiting on a
// client fetch). This component just receives that server-fetched
// data as a prop and adds client-only interactivity on top.
export function DiscoverySplitView({ listings, gridHeader, listingType, focusLocation }: DiscoverySplitViewProps) {
  const typeFiltered =
    listingType === "rent" || listingType === "buy"
      ? listings.filter((listing) => listing.listing_type === listingType)
      : listings;
  const [hoveredId, setHoveredId] = useState<number | string | null>(null);
  const [visibleListingIds, setVisibleListingIds] = useState<Array<number | string>>(
    () => typeFiltered.map((listing) => listing.id),
  );
  const visibleListings = typeFiltered.filter((listing) => visibleListingIds.includes(listing.id));
  const [selectedListingId, setSelectedListingId] = useState<number | string | null>(null);
  const [selectedPoi, setSelectedPoi] = useState<MapPlacePreview | null>(null);
  const selectedListing = typeFiltered.find((listing) => listing.id === selectedListingId);

  // Re-seed map/grid client state when the toggle flips. (Previously
  // done via a key-remount of this whole tree — but tearing down the
  // map on every flip also tore down its InfoWindow React root mid-
  // render, tripping React's "synchronously unmount a root" error.)
  // This is React's sanctioned "adjust state during render" pattern
  // (store previous listingType, compare, reset) — no effect, so no
  // setState-in-effect cascade and no extra commit.
  const [prevListingType, setPrevListingType] = useState(listingType);
  if (prevListingType !== listingType) {
    setPrevListingType(listingType);
    setVisibleListingIds(typeFiltered.map((listing) => listing.id));
    setSelectedListingId(null);
    setSelectedPoi(null);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-row">
      {/* Listing grid — the ONLY scrollable region on this page.
          Auto-scaling columns: the container decides how many cards
          fit via auto-fill, each card clamped between CARD_MIN
          (15rem, below which the photo/text crush) and CARD_MAX
          (21rem, above which cards look stretched). Narrow pane →
          1 column; wide viewport → 3+. `content-start` keeps rows
          hugging card height (fit-content) instead of the grid
          default stretching them to fill the tall container.
          overflow-y-auto + min-h-0 is
          what actually makes this scroll independently of the map:
          without min-h-0, a flex child defaults to its content's
          natural height and never triggers its own scrollbar, growing
          the whole page instead — the classic flexbox scrolling
          gotcha. */}
      <div className="flex min-h-0 w-[50%] flex-none flex-col">
        {gridHeader && (
          <div className="shrink-0 px-10 py-5 border-b">{gridHeader}</div>
        )}
        <div className="grid min-h-0 flex-1 content-start grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] gap-6 overflow-y-auto p-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visibleListings.length === 0 ? (
          <p className="text-muted-foreground col-span-full py-12 text-center text-sm">
            No listings match your search yet — try widening your filters.
          </p>
        ) : (
          visibleListings.map((listing) => (
            <div
              key={listing.id}
              className="w-full max-w-[32rem] min-w-0 min-h-[32rem] justify-self-center"
            >
              <DiscoveryListingCard
                listing={listing}
                isHovered={hoveredId === listing.id}
                onHover={setHoveredId}
              />
            </div>
          ))
        )}
        </div>
      </div>

      {/* Map pane — fixed/sticky, fills all remaining width and the
          full available height, never scrolls with the grid. Always
          side-by-side (left grid / right map), never stacked
          top/bottom at any viewport width. */}
      <div className="relative min-h-0 flex-1 p-5">
        <div className="rounded-xl overflow-hidden border w-full h-full">
          <DiscoveryMap
            // Type-filtered too — markers must match the grid, or the
            // hover-sync cross-referencing breaks (pin with no card).
            listings={typeFiltered}
            searchFocus={focusLocation ?? null}
            onVisibleListingsChange={setVisibleListingIds}
            hoveredId={hoveredId}
            selectedListing={selectedListing ?? null}
            selectedPoi={selectedPoi}
            onMarkerClick={(id) => {
              setSelectedListingId(id);
              setSelectedPoi(null);
              // Scroll the matching card into view rather than
            // navigating immediately — clicking a pin is closer to
            // "show me that one" than "commit to that one," matching
            // the split-pane's whole point of letting a visitor
            // cross-reference before opening a listing.
            const el = document.getElementById(`listing-card-${id}`);
            el?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
          onMarkerHover={setHoveredId}
          onPoiClick={(place) => {
            setSelectedPoi(place);
            setSelectedListingId(null);
          }}
          onClosePreview={() => {
            setSelectedListingId(null);
            setSelectedPoi(null);
          }}
        /></div>
      </div>
    </div>
  );
}
