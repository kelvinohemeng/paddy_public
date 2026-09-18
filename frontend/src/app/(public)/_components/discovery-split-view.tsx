"use client";

import { useState } from "react";
import { DiscoveryMap } from "./discovery-map";
import { DiscoveryListingCard, type PublicListing } from "./discovery-listing-card";
import type { MapPlacePreview } from "./discovery-map";

type DiscoverySplitViewProps = {
  listings: PublicListing[];
};

// Client island for the interactive half of the hub (hover-sync
// between grid cards and map markers) — the page itself stays a
// server component so the INITIAL listing fetch is real SSR (crawlers
// and first paint get real HTML, not an empty shell waiting on a
// client fetch). This component just receives that server-fetched
// data as a prop and adds client-only interactivity on top.
export function DiscoverySplitView({ listings }: DiscoverySplitViewProps) {
  const [hoveredId, setHoveredId] = useState<number | string | null>(null);
  const [visibleListingIds, setVisibleListingIds] = useState<Array<number | string>>(
    () => listings.map((listing) => listing.id),
  );
  const visibleListings = listings.filter((listing) => visibleListingIds.includes(listing.id));
  const [selectedListingId, setSelectedListingId] = useState<number | string | null>(null);
  const [selectedPoi, setSelectedPoi] = useState<MapPlacePreview | null>(null);
  const selectedListing = listings.find((listing) => listing.id === selectedListingId);

  return (
    <div className="flex min-h-0 flex-1 flex-row">
      {/* Listing grid — the ONLY scrollable region on this page.
          2 columns (matches the requested "2 col to the left"), each
          card's own aspect-video photo means 2 cols reads better than
          3+ at typical viewport widths without the map pane eating
          into it. overflow-y-auto + min-h-0 is what actually makes
          this scroll independently of the map: without min-h-0, a
          flex child defaults to its content's natural height and
          never triggers its own scrollbar, growing the whole page
          instead — the classic flexbox scrolling gotcha. */}
      <div className="grid min-h-0 w-[45%] flex-none grid-cols-2 gap-4 overflow-y-auto p-4">
        {visibleListings.length === 0 ? (
          <p className="text-muted-foreground col-span-full py-12 text-center text-sm">
            No listings match your search yet — try widening your filters.
          </p>
        ) : (
          visibleListings.map((listing) => (
            <DiscoveryListingCard
              key={listing.id}
              listing={listing}
              isHovered={hoveredId === listing.id}
              onHover={setHoveredId}
            />
          ))
        )}
      </div>

      {/* Map pane — fixed/sticky, fills all remaining width and the
          full available height, never scrolls with the grid. Always
          side-by-side (left grid / right map), never stacked
          top/bottom at any viewport width. */}
      <div className="relative min-h-0 flex-1">
        <DiscoveryMap
          listings={listings}
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
        />
      </div>
    </div>
  );
}
