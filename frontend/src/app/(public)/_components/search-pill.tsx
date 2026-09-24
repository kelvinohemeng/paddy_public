"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, CalendarClock, Coins } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PlaceAutocompleteInput } from "@/components/maps/place-autocomplete-input";
import { DISCOVERY_PATH } from "./discovery-path";

// "Where / Advance / Price Cap". Advance maps to the backend's
// `advance_rent_period` choices on Listing (AdvanceRentPeriod in
// backend/listings/models.py) — `6_months` ("6 Months") and `1_year`
// ("1 Year"); `none` exists on the model but isn't a useful search
// filter, so the pill offers Any + the two periods. The backend
// filters it with an exact match (ListingViewSet.get_queryset), so
// the pill sends the raw backend value, never a display label.
//
// "Where" uses the SAME PlaceAutocompleteInput wrapper as
// listing-create-form.tsx's address field (see that component for why
// this isn't the deprecated google.maps.places.Autocomplete class —
// Google stopped offering it to new customers as of March 1, 2025).
// Worldwide: no region/type restrictions — anyone from anywhere can
// search anything. Picking a suggestion keeps its full formatted
// address as the query (matching what the map looks up on submit).
// Typing free text without picking a suggestion still works too:
// whatever's typed is sent as-is and the map still pans to it
// (see DiscoveryMap's searchFocus Text Search lookup).
// "Price Cap" maps to `max_price` (same query param the backend
// already reads).
//
// Submits by pushing a new URL with query params — the hub page
// (homes/page.tsx) reads these server-side on render, so this
// component doesn't need to know about useList/dataProvider at all,
// and the search is a real, bookmarkable/shareable/back-button-safe
// URL rather than hidden client state.

export function SearchPill({
  // `/` is the marketing page — searches always land on the hub.
  basePath = DISCOVERY_PATH,
}: {
  basePath?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [city, setCity] = useState(searchParams.get("city") ?? "");
  const [maxPrice, setMaxPrice] = useState(searchParams.get("max_price") ?? "");
  // Raw backend value (`6_months` / `1_year`), "" = Any. Initialized
  // from the URL so back-button / shared links restore the pill —
  // sanitized to known values so a hand-edited URL can never send the
  // backend a value it won't match.
  const rawAdvance = searchParams.get("advance_rent_period");
  const [advancePeriod, setAdvancePeriod] = useState(
    rawAdvance === "6_months" || rawAdvance === "1_year" ? rawAdvance : "",
  );
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams(searchParams.toString());

    if (city.trim()) params.set("city", city.trim());
    else params.delete("city");

    if (advancePeriod) params.set("advance_rent_period", advancePeriod);
    else params.delete("advance_rent_period");

    if (maxPrice.trim()) params.set("max_price", maxPrice.trim());
    else params.delete("max_price");

    router.push(`${basePath}?${params.toString()}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-background mx-auto flex w-full max-w-2xl flex-wrap items-center gap-1 rounded-xl border p-1.5 shadow-sm sm:flex-nowrap sm:gap-2"
    >
      {/* Mobile (Figma "Default Mobile"): Where takes its own row, the
          rest share the second — keeps Budget reachable on phones
          instead of dropping it like the 380px frame does. */}
      <div className="flex basis-full items-center rounded-full px-3 py-1.5 outline-none focus-within:outline-none sm:flex-1 sm:basis-auto sm:px-4 sm:py-2">
        <PlaceAutocompleteInput
          value={city}
          onChange={setCity}
          onPlaceSelect={(place) => {
            // Keep exactly what was picked — no locality collapsing.
            // (An earlier version rewrote every pick to its `locality`
            // address component, so clicking anything in Accra just set
            // the input back to "Accra".) The full formatted address
            // is what the map looks up on submit.
            if (place.formattedAddress) setCity(place.formattedAddress);
          }}
          placeholder="Where — city, neighborhood, or address…"
        />
      </div>

      <div className="bg-border hidden h-6 w-px sm:block" />

      <div className="flex-1">
      <Popover open={advanceOpen} onOpenChange={setAdvanceOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="hover:bg-muted flex flex-1 items-center gap-2 rounded-full px-3 py-2 text-left sm:px-4"
          >
            <CalendarClock className="text-muted-foreground size-4 shrink-0" />
            <span className="text-sm">
              {advancePeriod === "6_months"
                ? "6mo advance"
                : advancePeriod === "1_year"
                  ? "1yr advance"
                  : "Advance"}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56" align="start">
          <p className="text-sm font-medium">Advance rent period</p>
          <div className="mt-2 flex flex-col gap-1">
            {(
              [
                { value: "", label: "Any advance" },
                { value: "6_months", label: "6 Months" },
                { value: "1_year", label: "1 Year" },
              ] as const
            ).map((option) => {
              const selected = advancePeriod === option.value;
              return (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setAdvancePeriod(option.value);
                    setAdvanceOpen(false);
                  }}
                  className={
                    selected
                      ? "bg-muted rounded-md px-3 py-2 text-left text-sm font-medium"
                      : "hover:bg-muted rounded-md px-3 py-2 text-left text-sm"
                  }
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      </div>

      <div className="bg-border hidden h-6 w-px sm:block" />

      <div className="flex-1">
      <Popover  open={priceOpen} onOpenChange={setPriceOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="hover:bg-muted flex flex-1 items-center gap-2 rounded-full px-3 py-2 text-left sm:px-4"
          >
            <Coins className="text-muted-foreground size-4 shrink-0" />
            <span className="text-sm whitespace-nowrap">
              {maxPrice ? `Up to GHS ${maxPrice}/mo` : "Price cap"}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64" align="start">
          <label className="text-sm font-medium">
            Max monthly price (GHS)
          </label>
          <Input
            type="number"
            min={0}
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            placeholder="e.g. 3000"
            className="mt-2"
          />
        </PopoverContent>
      </Popover>

      </div>


      <Button type="submit" size="icon" className="shrink-0 rounded-full">
        <Search className="size-4" />
      </Button>
    </form>
  );
}
