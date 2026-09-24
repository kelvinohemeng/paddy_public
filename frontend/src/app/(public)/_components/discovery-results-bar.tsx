"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";

import { useApiList } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import { DISCOVERY_PATH } from "./discovery-path";

type Amenity = { id: number; name: string; slug: string };

// Results-count row above the listing grid.
//   Figma "Default State": "30 Places to stay" + Filter pill (Faders).
//   Figma "Filter Expanded": the count is replaced by amenity chips
//     (Wifi / Free Parking / Kitchen …) and the Filter pill becomes
//     "× Close".
//   Figma "Empty State": "0 Places available".
//   Mobile sheet: circular icon button instead of the pill; the count
//     can itself be a button (sheet peek → opens the list view).
// `filters=open` and `amenities=<slug>` (repeatable) are URL state —
// page.tsx forwards `amenities` to the backend, which keeps listings
// having ANY of the picked amenities.
export function DiscoveryResultsBar({
  count,
  city,
  variant = "pill",
  countOnClick,
  basePath = DISCOVERY_PATH,
}: {
  count: number;
  city?: string;
  variant?: "pill" | "icon";
  countOnClick?: () => void;
  basePath?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const expanded = searchParams.get("filters") === "open";
  const selected = searchParams.getAll("amenities");

  // GET /core/amenities/ — public read (see backend core/urls.py).
  // Only fetched once the filter row is actually opened.
  const { data: amenities } = useApiList<Amenity>("core/amenities", {
    enabled: expanded,
  });

  function push(params: URLSearchParams) {
    const query = params.toString();
    router.push(query ? `${basePath}?${query}` : basePath, { scroll: false });
  }

  function toggleFilters() {
    const params = new URLSearchParams(searchParams.toString());
    if (expanded) params.delete("filters");
    else params.set("filters", "open");
    push(params);
  }

  function toggleAmenity(slug: string) {
    const params = new URLSearchParams(searchParams.toString());
    const next = selected.includes(slug)
      ? selected.filter((s) => s !== slug)
      : [...selected, slug];
    params.delete("amenities");
    next.forEach((s) => params.append("amenities", s));
    push(params);
  }

  const countLabel =
    count === 0 ? (
      "0 Places available"
    ) : (
      <>
        {count} Place{count === 1 ? "" : "s"} to stay
        {city ? ` in ${city}` : ""}
      </>
    );

  return (
    <div className="flex items-center justify-between gap-3">
      {expanded ? (
        <div
          role="group"
          aria-label="Filter by amenity"
          className="-my-1 flex min-w-0 flex-1 gap-2 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {(amenities?.data ?? []).map((amenity) => {
            const on = selected.includes(amenity.slug);
            return (
              <button
                key={amenity.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggleAmenity(amenity.slug)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition",
                  on
                    ? "border-black bg-black text-white"
                    : "bg-neutral-100 text-black/80 hover:bg-neutral-200",
                )}
              >
                {amenity.name}
              </button>
            );
          })}
        </div>
      ) : countOnClick ? (
        <button
          type="button"
          onClick={countOnClick}
          className="text-sm font-semibold"
        >
          {countLabel}
        </button>
      ) : (
        <p className="text-sm font-semibold">{countLabel}</p>
      )}
      <button
        type="button"
        onClick={toggleFilters}
        aria-expanded={expanded}
        aria-label={expanded ? "Close filters" : "Open filters"}
        className={cn(
          "inline-flex shrink-0 items-center justify-center border bg-neutral-100 transition hover:bg-neutral-200",
          variant === "icon" && !expanded
            ? "size-9 rounded-full"
            : "gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
        )}
      >
        {expanded ? (
          <X className="size-3.5" aria-hidden />
        ) : (
          <SlidersHorizontal
            className={variant === "icon" ? "size-4" : "size-3.5"}
            aria-hidden
          />
        )}
        {expanded ? "Close" : variant === "pill" && "Filter"}
        {!expanded && selected.length > 0 && (
          <span className="flex size-4 items-center justify-center rounded-full bg-black text-[10px] text-white">
            {selected.length}
          </span>
        )}
      </button>
    </div>
  );
}
