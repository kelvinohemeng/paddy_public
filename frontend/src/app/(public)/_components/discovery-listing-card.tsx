"use client";

import Link from "next/link";
import { Bed, Bath, MapPin } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Backend's ListingPhotoSerializer returns `image` as the photo URL
// field (fields = ['id', 'image', 'order', 'is_cover']) — the other
// two keys here are defensive fallbacks only, in case that shape
// ever changes.
function getPhotoUrl(photo: any): string | null {
  return photo?.image ?? photo?.image_url ?? photo?.url ?? null;
}

export type PublicListing = {
  id: number | string;
  title: string;
  city: string;
  neighborhood: string;
  bedrooms: number;
  bathrooms: number;
  price_monthly: string | null;
  price_one_time: string | null;
  listing_type: "rent" | "buy";
  advance_rent_period: string | null;
  location: string | null;
  photos?: any[];
};

type DiscoveryListingCardProps = {
  listing: PublicListing;
  isHovered: boolean;
  onHover: (id: number | string | null) => void;
};

export function DiscoveryListingCard({
  listing,
  isHovered,
  onHover,
}: DiscoveryListingCardProps) {
  const photos = Array.isArray(listing.photos) ? listing.photos : [];
  const coverUrl = photos.length > 0 ? getPhotoUrl(photos[0]) : null;

  const price =
    listing.listing_type === "buy"
      ? listing.price_one_time
      : listing.price_monthly;
  const priceLabel =
    listing.listing_type === "buy" ? "GHS {price}" : "GHS {price}/mo";

  return (
    <Link
      href={`/homes/${listing.id}`}
      id={`listing-card-${listing.id}`}
      onMouseEnter={() => onHover(listing.id)}
      onMouseLeave={() => onHover(null)}
    >
      <Card
        className={cn(
          "cursor-pointer overflow-hidden py-0 transition hover:shadow-md",
          isHovered && "ring-2 ring-indigo-500",
          // Mirrors DiscoveryMap's hovered-pin highlight — hovering
          // EITHER the card or its map marker highlights both, so the
          // split-pane reads as one connected view rather than two
          // independent lists that happen to share a page.
        )}
      >
        <div className="bg-muted aspect-video w-full overflow-hidden">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverUrl}
              alt={listing.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
              No photo yet
            </div>
          )}
        </div>
        <CardContent className="space-y-2 py-4">
          <p className="truncate font-medium">{listing.title}</p>

          <p className="text-muted-foreground flex items-center gap-1 truncate text-xs">
            <MapPin className="size-3 shrink-0" />
            {listing.neighborhood || listing.city || "Ghana"}
          </p>

          <div className="text-muted-foreground flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1">
              <Bed className="size-3" /> {listing.bedrooms}
            </span>
            <span className="flex items-center gap-1">
              <Bath className="size-3" /> {listing.bathrooms}
            </span>
            {listing.advance_rent_period && listing.advance_rent_period !== "none" && (
              <Badge variant="secondary" className="text-[10px]">
                {listing.advance_rent_period === "6_months" ? "6mo advance" : "1yr advance"}
              </Badge>
            )}
            {price && (
              <span className="text-foreground ml-auto font-medium">
                {priceLabel.replace("{price}", price)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
