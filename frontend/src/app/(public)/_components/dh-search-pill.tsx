"use client";

import { useId, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PlaceAutocompleteInput } from "@/components/maps/place-autocomplete-input";
import { cn } from "@/lib/utils";
import { DISCOVERY_PATH } from "./discovery-path";

// Discovery Hub search — Figma Handoff → "DH_Search Pill" (280:4317),
// read 2026-09-27 via the Figma plugin API. Replaces the older
// SearchPill + separate RentBuyToggle row.
//
// Layout (773x116 in Figma; fluid here, max 773px):
// - Rent/Buy tabs sit on top of the pill's MIDDLE third (258px wide):
//   #fbfbfb, 1px #d9d9d9 on top/left/right, 12px top corners, 6px
//   padding. Selected tab #f2f2f2 with 8px corners; labels Clash
//   Display Medium 12, -2%.
// - The pill: white, 1px #d9d9d9, 12px corners, 64px tall, three equal
//   columns (Where | Duration | Budget), 20px side padding, 3px between
//   label and value. The middle column is tinted #e3e3e3 at 30% with
//   0.73px #d9d9d9 dividers.
//   Labels: Clash Display Medium 13, -4%, black 80%.
//   Values: Inter Medium 11, -3%; Figma's placeholder look is black 30%.
// - One drop shadow over the whole thing: 0 8px 12px 6px black 15%.
//   CSS can't shadow two boxes as one silhouette with spread, so both
//   carry it and the pill is stacked above the tabs to hide the seam.
//
// Behaviour (kept from the old pill — same URL params, so page.tsx and
// the backend filters are unchanged):
// - Where    → `city` (Google Places autocomplete, free text allowed)
// - Duration → `advance_rent_period` (`6_months` / `1_year`, "" = any)
// - Budget   → `max_price`
// - Rent/Buy → `listing_type` (client-side filter in DiscoverySplitView;
//              the backend has no listing_type filter)
// Figma has no search button, so a search runs on Enter, on picking a
// place or a duration, on switching Rent/Buy, and when the budget field
// loses focus after being changed.

type Duration = "" | "6_months" | "1_year";
type ListingType = "rent" | "buy";

const DURATION_OPTIONS: { value: Duration; label: string }[] = [
  { value: "", label: "Any" },
  { value: "6_months", label: "6 months" },
  { value: "1_year", label: "1 year" },
];

const LABEL =
  "font-display text-[13px] leading-4 font-medium tracking-[-0.04em] text-black/80";
const VALUE =
  "font-sans text-[11px] leading-[13px] font-medium tracking-[-0.03em]";
// Figma's value text is a placeholder (black 30%); real values read at 80%.
const PLACEHOLDER = "text-black/30 placeholder:text-black/30";
const FILLED = "text-black/80";

export function DHSearchPill({
  basePath = DISCOVERY_PATH,
  className,
}: {
  basePath?: string;
  className?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const whereId = useId();
  const budgetId = useId();

  const [city, setCity] = useState(searchParams.get("city") ?? "");
  const [maxPrice, setMaxPrice] = useState(searchParams.get("max_price") ?? "");
  // Sanitized to known values so a hand-edited URL can never send the
  // backend a value it won't match.
  const rawAdvance = searchParams.get("advance_rent_period");
  const [duration, setDuration] = useState<Duration>(
    rawAdvance === "6_months" || rawAdvance === "1_year" ? rawAdvance : "",
  );
  const listingType: ListingType =
    searchParams.get("listing_type") === "buy" ? "buy" : "rent";
  const [durationOpen, setDurationOpen] = useState(false);
  // Budget value last pushed to the URL — blur only searches if changed.
  const committedPrice = useRef(maxPrice);

  // Builds the URL from the current field values, with per-call
  // overrides for the field that just changed (state updates are async,
  // so the new value is passed in directly).
  function search(
    overrides: Partial<{
      city: string;
      duration: Duration;
      maxPrice: string;
      listingType: ListingType;
    }> = {},
  ) {
    const next = { city, duration, maxPrice, listingType, ...overrides };
    const params = new URLSearchParams(searchParams.toString());
    const set = (key: string, value: string) =>
      value.trim() ? params.set(key, value.trim()) : params.delete(key);

    set("city", next.city);
    set("advance_rent_period", next.duration);
    set("max_price", next.maxPrice);
    params.set("listing_type", next.listingType);

    committedPrice.current = next.maxPrice;
    router.push(`${basePath}?${params.toString()}`);
  }

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        search();
      }}
      className={cn("mx-auto flex w-full max-w-[773px] flex-col", className)}
    >
      {/* Rent / Buy tabs — over the middle third on desktop, full width
          on phones. */}
      <div
        role="radiogroup"
        aria-label="Listing type"
        className="shadow-pill border-hairline relative z-0 mx-auto flex w-full rounded-t-xl border border-b-0 bg-[#fbfbfb] p-1.5 sm:w-1/3"
      >
        {(["rent", "buy"] as const).map((option) => {
          const selected = listingType === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => search({ listingType: option })}
              className={cn(
                "font-display flex h-[39px] flex-1 cursor-pointer items-center justify-center px-[19px] text-xs leading-[15px] font-medium tracking-[-0.02em] whitespace-nowrap text-black transition-colors",
                "focus-visible:ring-2 focus-visible:ring-[#3b82f6]/60 focus-visible:outline-none",
                selected
                  ? "bg-surface rounded-lg"
                  : "rounded-xl hover:bg-black/[0.03]",
              )}
            >
              {option === "rent" ? "Rent a property" : "Buy a property"}
            </button>
          );
        })}
      </div>

      <div className="shadow-pill border-hairline relative z-10 grid grid-cols-2 rounded-xl border bg-white sm:h-16 sm:grid-cols-3">
        {/* Where */}
        <div className="border-hairline col-span-2 flex h-[62px] flex-col justify-center gap-[3px] border-b px-5 sm:col-span-1 sm:border-b-0">
          <label htmlFor={whereId} className={LABEL}>
            Where
          </label>
          <PlaceAutocompleteInput
            appearance="bare"
            id={whereId}
            value={city}
            onChange={setCity}
            onPlaceSelect={(place) => {
              // Keep exactly what was picked (its full formatted
              // address is what the map looks up) and search right away.
              if (place.formattedAddress) {
                setCity(place.formattedAddress);
                search({ city: place.formattedAddress });
              }
            }}
            placeholder="Search Destination"
            inputClassName={cn(
              VALUE,
              "h-[13px] rounded-none py-0 md:text-[11px]",
              city ? FILLED : PLACEHOLDER,
            )}
          />
        </div>

        {/* Duration — the advance-rent period. */}
        <Popover open={durationOpen} onOpenChange={setDurationOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Duration: ${DURATION_OPTIONS.find((o) => o.value === duration)?.label}`}
              className="border-hairline flex h-[62px] cursor-pointer flex-col justify-center gap-[3px] border-r-[0.73px] bg-[#e3e3e3]/30 px-5 text-left outline-none focus-visible:bg-[#e3e3e3]/60 max-sm:rounded-bl-xl sm:border-l-[0.73px]"
            >
              <span className={LABEL}>Duration</span>
              <span className={cn(VALUE, duration ? FILLED : PLACEHOLDER)}>
                {DURATION_OPTIONS.find((o) => o.value === duration)?.label}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1.5" align="start">
            <p className={cn(LABEL, "px-2 pt-1 pb-2")}>Advance rent period</p>
            <div className="flex flex-col gap-0.5">
              {DURATION_OPTIONS.map((option) => {
                const selected = duration === option.value;
                return (
                  <button
                    key={option.label}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setDuration(option.value);
                      setDurationOpen(false);
                      search({ duration: option.value });
                    }}
                    className={cn(
                      "cursor-pointer rounded-md px-2 py-1.5 text-left text-[13px] font-medium",
                      selected ? "bg-surface" : "hover:bg-surface/60",
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>

        {/* Budget — max monthly price in cedis. */}
        <div className="flex h-[62px] flex-col justify-center gap-[3px] px-5">
          <label htmlFor={budgetId} className={LABEL}>
            Budget
          </label>
          <input
            id={budgetId}
            type="number"
            inputMode="numeric"
            min={0}
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            onBlur={() => {
              if (maxPrice !== committedPrice.current) search();
            }}
            placeholder="GHC"
            className={cn(
              VALUE,
              "w-full [appearance:textfield] bg-transparent outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
              maxPrice ? FILLED : PLACEHOLDER,
            )}
          />
        </div>
      </div>

      {/* Enter-to-submit needs a submit control in the form; hidden so
          the pill stays exactly as designed. */}
      <button type="submit" className="sr-only" tabIndex={-1}>
        Search
      </button>
    </form>
  );
}
