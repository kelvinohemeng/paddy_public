"use client";

import { useState } from "react";
import { LayoutGrid, Map as MapIcon } from "lucide-react";

import { useIsMobile } from "@/hooks/use-mobile";
import { useSavedListings } from "@/hooks/use-saved-listings";
import { cn } from "@/lib/utils";
import { DiscoveryMap } from "./discovery-map";
import { DiscoveryResultsBar } from "./discovery-results-bar";
import { sheetOffset, useSheetDrag } from "./use-sheet-drag";
import { DiscoveryListingCard, type PublicListing } from "./discovery-listing-card";
import type { MapPlacePreview } from "./discovery-map";

type DiscoverySplitViewProps = {
  listings: PublicListing[];
  // Optional notice above the results row (e.g. the city-fallback
  // banner). The results row itself is rendered here, so it can switch
  // between the desktop pill and the mobile sheet's icon variant.
  notice?: React.ReactNode;
  // Searched city, echoed in "N Places to stay in {city}".
  city?: string;
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
export function DiscoverySplitView({ listings, notice, city, listingType, focusLocation }: DiscoverySplitViewProps) {
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

  const { mode: favoriteMode, isSaved, toggle: toggleSaved } = useSavedListings();
  // Mobile only: which half of the hub is in front. Desktop always
  // shows both side by side and ignores this.
  const [mobileView, setMobileView] = useState<"map" | "grid">("map");
  // The Grid/Map pill moves first, then the sheet follows — so the
  // switch visibly slides before it tucks away with the sheet.
  const [pill, setPill] = useState<"map" | "grid">("map");
  const isMobile = useIsMobile();
  const sheetOpen = mobileView === "grid";

  const count = visibleListings.length;
  const emptyMessage = (
    <p className="col-span-full py-24 text-center text-sm font-medium text-black/80">
      No Listings Available in this area
    </p>
  );

  function showGrid() {
    setPill("grid");
    setMobileView("grid");
  }

  function showMap() {
    setPill("map");
    window.setTimeout(() => setMobileView("map"), 160);
  }

  const { drag, bind } = useSheetDrag({ onOpen: showGrid, onClose: showMap });

  return (
    <div className="relative flex min-h-0 flex-1 flex-row">
      {/* Listing column.
          Desktop: left half, the ONLY scrollable region on the page
          (min-h-0 + overflow-y-auto is what lets it scroll
          independently of the map — without min-h-0 a flex child
          grows to its content instead).
          Mobile (Figma "Default Mobile - Expanded"): a rounded sheet
          over the map. It stays mounted and slides (translateY via
          --sheet-y, mobile-only classes) so it can follow a drag; the
          map underneath is never torn down (that re-inits Google Maps
          and its InfoWindow root). Inert while tucked away. */}
      <div
        inert={isMobile && !sheetOpen ? true : undefined}
        style={{ "--sheet-y": sheetOffset(sheetOpen, drag) } as React.CSSProperties}
        className={cn(
          "bg-background flex min-h-0 flex-col",
          "md:static md:z-auto md:flex md:w-1/2 md:flex-none md:rounded-none md:shadow-none",
          "absolute inset-0 z-20 rounded-t-2xl shadow-[0_2px_6px_2px_rgba(0,0,0,0.15)]",
          "max-md:[transform:translateY(var(--sheet-y))]",
          !drag &&
            "max-md:transition-transform max-md:duration-300 max-md:ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
        )}
      >
        {/* Grab area: drag the handle down to close the list. */}
        <div
          {...bind("close")}
          aria-hidden
          className="-mb-1 flex h-6 shrink-0 cursor-grab touch-none items-start justify-center active:cursor-grabbing md:hidden"
        >
          <SheetHandle />
        </div>
        <div className="shrink-0 space-y-2 border-b px-5 py-3 md:px-10 md:py-5">
          {notice}
          <div className="hidden md:block">
            <DiscoveryResultsBar count={count} city={city} />
          </div>
          <div className="md:hidden">
            <DiscoveryResultsBar count={count} city={city} variant="icon" />
          </div>
        </div>
        {/* Auto-scaling columns: each card at least 16rem, so the
            half-width pane gets Figma's 2 columns at 1440px and 3 on
            wider screens; a narrow pane falls back to 1.
            Bottom padding on mobile clears the floating Grid/Map switch. */}
        <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-6 overflow-y-auto p-5 pb-28 [scrollbar-width:none] md:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] md:p-10 [&::-webkit-scrollbar]:hidden">
          {count === 0
            ? emptyMessage
            : visibleListings.map((listing) => (
                <div
                  key={listing.id}
                  className="w-full max-w-[28rem] min-w-0 justify-self-center"
                >
                  <DiscoveryListingCard
                    listing={listing}
                    isHovered={hoveredId === listing.id}
                    onHover={setHoveredId}
                    favorite={
                      favoriteMode === "hidden"
                        ? undefined
                        : {
                            saved: isSaved(listing.id),
                            onToggle: () => toggleSaved(listing.id),
                          }
                    }
                  />
                </div>
              ))}
        </div>
      </div>

      {/* Map pane — desktop: fills the right half, never scrolls.
          Mobile: fills the whole area under the header. */}
      <div className="relative min-h-0 flex-1 md:p-5">
        <div className="h-full w-full overflow-hidden md:rounded-xl md:border">
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
              // "show me that one" than "commit to that one". On
              // mobile the card list is hidden behind the map, so
              // the map's own preview card does that job instead.
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

        {/* Figma "Default Mobile - Map - No Pins": floating notice. */}
        {count === 0 && (
          <p className="pointer-events-none absolute bottom-24 left-1/2 z-10 -translate-x-1/2 rounded-full border bg-white px-3 py-3 text-sm font-medium whitespace-nowrap text-black/80 shadow-md md:hidden">
            No Listings Available
          </p>
        )}

        {/* Figma "Default Mobile - Map": sheet peek at the bottom.
            Tap or drag it up to open the list (onClick keeps it
            keyboard-operable; a tap opening twice is harmless). */}
        <button
          type="button"
          onClick={showGrid}
          {...bind("open")}
          className="absolute inset-x-0 bottom-0 z-10 flex touch-none flex-col items-center gap-2 rounded-t-2xl bg-white pt-2 pb-5 shadow-[0_2px_6px_2px_rgba(0,0,0,0.15)] md:hidden"
        >
          <SheetHandle />
          <span className="text-sm font-medium text-black/80">
            {count === 0
              ? "0 Places available"
              : `${count} Place${count === 1 ? "" : "s"}${city ? ` in ${city}` : " to stay"}`}
          </span>
        </button>
      </div>

      {/* Figma Grid/Map switch — floats over the open list sheet on
          mobile. Fades up with the sheet; the white pill slides to the
          tapped option before the sheet closes. */}
      <div
        inert={!sheetOpen ? true : undefined}
        className={cn(
          "absolute bottom-8 left-1/2 z-30 -translate-x-1/2 rounded-full border bg-white p-1.5 shadow-[0_4px_2px_rgba(0,0,0,0.25)] transition-all duration-300 ease-out motion-reduce:transition-none md:hidden",
          sheetOpen && !drag ? "opacity-100" : "pointer-events-none translate-y-4 opacity-0",
        )}
      >
        <div className="relative grid grid-cols-2">
          <span
            aria-hidden
            className={cn(
              "absolute inset-y-0 left-0 w-1/2 rounded-full bg-white shadow-[0_4px_4px_rgba(0,0,0,0.16),inset_0_-2px_4px_rgba(0,0,0,0.08)] transition-transform duration-200 ease-out motion-reduce:transition-none",
              pill === "map" && "translate-x-full",
            )}
          />
          <ViewSwitchButton
            active={pill === "grid"}
            icon={<LayoutGrid className="size-3" />}
            label="Grid"
            onClick={showGrid}
          />
          <ViewSwitchButton
            active={pill === "map"}
            icon={<MapIcon className="size-3.5" />}
            label="Map"
            onClick={showMap}
          />
        </div>
      </div>
    </div>
  );
}

function SheetHandle({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("mx-auto mt-2 block h-[5px] w-[58px] shrink-0 rounded-full bg-neutral-300", className)}
    />
  );
}

function ViewSwitchButton({
  active = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "relative flex items-center justify-center gap-1 rounded-full px-4 py-2.5 text-xs font-medium transition-colors",
        active ? "text-black" : "text-black/60",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
