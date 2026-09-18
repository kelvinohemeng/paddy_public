"use client";

import Link from "next/link";
import { Star, X } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import type { MapListing, MapPlacePreview } from "./discovery-map";

// The actual JSX rendered inside the map's InfoWindow (see
// discovery-map.tsx's mountInfoWindowContent — an InfoWindow only
// accepts a DOM node, so this component gets mounted into a detached
// div via createRoot rather than returned from a parent's render
// tree). Because of that boundary, this component owns its own click
// handling (onClose) instead of relying on InfoWindow's built-in
// close button/chrome, which we deliberately don't use here so we
// have full control over the card's look.

function previewPhotoUrl(photo: any): string | null {
  return photo?.image ?? photo?.image_url ?? photo?.url ?? null;
}

function listingPrice(listing: MapListing): string {
  const raw = listing.listing_type === "buy" ? listing.price_one_time : listing.price_monthly;
  if (!raw) return "Price on request";
  return `GHS ${raw}${listing.listing_type === "buy" ? "" : "/mo"}`;
}

type MapPreviewCardProps = {
  listing: MapListing | null;
  poi: MapPlacePreview | null;
  onClose: () => void;
};

export function MapPreviewCard({ listing, poi, onClose }: MapPreviewCardProps) {
  const imageUrl = listing ? previewPhotoUrl(listing.photos?.[0]) : poi?.photoUrl;
  const title = listing?.title || poi?.name || "Nearby place";
  const subtitle = listing
    ? listing.neighborhood || listing.city || "Ghana"
    : poi?.address || "Nearby place";

  return (
    <Card className="w-64 gap-0 overflow-hidden rounded-2xl border-0 py-0 shadow-none">
      <div className="bg-muted relative aspect-[16/10] w-full overflow-hidden">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={title} className="h-full w-full object-cover" />
        ) : (
          <div className="text-muted-foreground flex h-full w-full items-center justify-center text-xs">
            No photo yet
          </div>
        )}

        <button
          type="button"
          aria-label="Close preview"
          onClick={onClose}
          className={cn(
            "absolute right-2 top-2 flex size-6 items-center justify-center rounded-full",
            "bg-background/90 text-foreground shadow hover:bg-background",
          )}
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="space-y-1.5 p-3.5">
        <p className="truncate text-sm font-semibold leading-tight">{title}</p>
        <p className="text-muted-foreground truncate text-xs">{subtitle}</p>

        {listing ? (
          <div className="flex items-center justify-between pt-1">
            <span className="text-sm font-bold">{listingPrice(listing)}</span>
            <Link
              href={`/homes/${listing.id}`}
              className="text-primary text-xs font-semibold underline-offset-2 hover:underline"
            >
              View listing →
            </Link>
          </div>
        ) : poi?.rating ? (
          <div className="flex items-center gap-1 pt-1 text-xs font-medium">
            <Star className="size-3.5 fill-current text-amber-500" />
            {poi.rating.toFixed(1)}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
