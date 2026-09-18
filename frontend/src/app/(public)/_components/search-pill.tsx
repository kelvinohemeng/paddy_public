"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, MapPin, CalendarDays, Coins } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PlaceAutocompleteInput } from "@/components/maps/place-autocomplete-input";

// "Where / Move-in Date / Price Cap" per AGENTS.md's build-priority #1
// spec. Move-in Date is intentionally NON-FUNCTIONAL right now — the
// Listing model has no availability/move-in-date field at all
// (confirmed against backend/listings/models.py on main), so wiring
// this up would either silently do nothing or require guessing at a
// backend contract that doesn't exist yet. It renders, disabled, with
// an explanatory label, rather than being omitted outright — keeps
// the three-pill shape the design calls for while being honest that
// it isn't live.
//
// "Where" uses the SAME PlaceAutocompleteInput wrapper as
// listing-create-form.tsx's address field (see that component for why
// this isn't the deprecated google.maps.places.Autocomplete class —
// Google stopped offering it to new customers as of March 1, 2025),
// biased to Ghana and restricted to locality/city-level results.
// Picking a suggestion pulls the city out of its addressComponents
// and searches by that — matching ListingViewSet.get_queryset's
// `city` query param (case-insensitive exact match). Typing free text
// without picking a suggestion still works too: whatever's typed is
// sent as-is, so "Accra" typed and Enter-ed behaves the same as
// picking "Accra, Ghana" from the dropdown.
// "Price Cap" maps to `max_price` (same query param the backend
// already reads).
//
// Submits by pushing a new URL with query params — the page itself
// (page.tsx) reads these server-side on render, so this component
// doesn't need to know about useList/dataProvider at all, and the
// search is a real, bookmarkable/shareable/back-button-safe URL
// rather than hidden client state.

export function SearchPill() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [city, setCity] = useState(searchParams.get("city") ?? "");
  const [maxPrice, setMaxPrice] = useState(searchParams.get("max_price") ?? "");
  const [priceOpen, setPriceOpen] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams(searchParams.toString());

    if (city.trim()) params.set("city", city.trim());
    else params.delete("city");

    if (maxPrice.trim()) params.set("max_price", maxPrice.trim());
    else params.delete("max_price");

    router.push(`/?${params.toString()}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-background mx-auto flex w-full max-w-2xl flex-col gap-2 rounded-full border p-1.5 shadow-sm sm:flex-row sm:items-center"
    >
      <div className="flex flex-1 items-center gap-2 rounded-full px-4 py-2">
        <MapPin className="text-muted-foreground size-4 shrink-0" />
        <PlaceAutocompleteInput
          value={city}
          onChange={setCity}
          onPlaceSelect={(place) => {
            const locality = place.addressComponents?.find((c) =>
              c.types.includes("locality"),
            )?.longText;
            setCity(locality ?? place.formattedAddress ?? city);
          }}
          placeholder="Where — e.g. Accra, East Legon…"
          includedRegionCodes={["gh"]}
          includedPrimaryTypes={["locality"]}
          // Restricted to cities/localities — this pill filters by
          // `city`, not a precise address, so street-level suggestions
          // (which the create form's autocomplete does want) would
          // just be noise here.
        />
      </div>

      <div className="bg-border hidden h-6 w-px sm:block" />

      <button
        type="button"
        disabled
        title="Move-in date filtering isn't available yet — the backend has no availability field on listings."
        className="text-muted-foreground flex flex-1 cursor-not-allowed items-center gap-2 rounded-full px-4 py-2 opacity-50"
      >
        <CalendarDays className="size-4 shrink-0" />
        <span className="text-sm">Move-in date (coming soon)</span>
      </button>

      <div className="bg-border hidden h-6 w-px sm:block" />

      <Popover open={priceOpen} onOpenChange={setPriceOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="hover:bg-muted flex flex-1 items-center gap-2 rounded-full px-4 py-2 text-left"
          >
            <Coins className="text-muted-foreground size-4 shrink-0" />
            <span className="text-sm">
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

      <Button type="submit" size="icon" className="shrink-0 rounded-full">
        <Search className="size-4" />
      </Button>
    </form>
  );
}
