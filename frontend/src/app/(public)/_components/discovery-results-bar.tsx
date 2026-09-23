"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { DISCOVERY_PATH } from "./discovery-path";

// Results-count row — Figma "30 Places to stay" + Filter button
// (Faders icon) above the listing grid, and the mobile sheet's
// "Over, 300 Places in Greater Accra" line. The Filter button
// toggles the `filters` URL param that page.tsx reads to show or
// hide the amenity-chip row (Figma's Filter Expanded state).
export function DiscoveryResultsBar({
  count,
  city,
  // Figma mobile sheet uses a circular icon button instead of the
  // desktop "Filter" pill; countOnClick turns the count itself into
  // a button (mobile sheet peek → opens the list view).
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

  function toggleFilters() {
    const params = new URLSearchParams(searchParams.toString());
    if (expanded) params.delete("filters");
    else params.set("filters", "open");
    const query = params.toString();
    router.push(query ? `${basePath}?${query}` : basePath);
  }

  const countLabel = (
    <>
      {count} Place{count === 1 ? "" : "s"} to stay
      {city ? ` in ${city}` : ""}
    </>
  );

  return (
    <div className="flex items-center justify-between gap-2">
      {countOnClick ? (
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
        aria-label="Toggle filters"
        className={
          variant === "icon"
            ? "inline-flex size-9 shrink-0 items-center justify-center rounded-full border transition hover:bg-muted"
            : "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
        }
      >
        <SlidersHorizontal
          className={variant === "icon" ? "size-4" : "size-3.5"}
          aria-hidden
        />
        {variant === "pill" && "Filter"}
      </button>
    </div>
  );
}
