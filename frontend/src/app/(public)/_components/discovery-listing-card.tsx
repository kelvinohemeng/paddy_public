"use client";

import Link from "next/link";
import { BadgeCheck, MapPin } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SaveToggle } from "@/components/save-toggle";
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
  // Figma "Listing Card" reconciliation (component set 175:21077):
  // all four are backend-computed and always present on real API rows,
  // but optional here so mocks/stories can omit what a state doesn't need.
  is_saved?: boolean;
  is_staff_verified?: boolean;
  landlord_public?: { full_name: string; id_verified: boolean } | null;
  amenities_detail?: { id: number; name: string; slug: string }[];
};

type DiscoveryListingCardProps = {
  listing: PublicListing;
  isHovered: boolean;
  onHover: (id: number | string | null) => void;
  // Figma shows a Favorite heart overlay on the photo. Rendered only on
  // explicit opt-in: anonymous visitors must see no toggle at all
  // (SaveToggle contract — saving requires a renter session).
  showSaveToggle?: boolean;
};

export function DiscoveryListingCard({
  listing,
  isHovered,
  onHover,
  showSaveToggle = false,
}: DiscoveryListingCardProps) {
  const photos = Array.isArray(listing.photos) ? listing.photos : [];
  const coverUrl = photos.length > 0 ? getPhotoUrl(photos[0]) : null;

  const price =
    listing.listing_type === "buy"
      ? listing.price_one_time
      : listing.price_monthly;
  // NOTE: Figma labels this "GHC 4,000" but the cedi's ISO code is GHS
  // (GHC is the pre-2007 code). Card follows Figma literally so visual
  // diffs stay clean; if we ever switch, switch detail page + stories too.
  const priceLabel =
    listing.listing_type === "buy" ? "GHC {price}" : "GHC {price}/mo";

  // Figma body pills: "{n} bedroom" / "{n} bathroom" + top amenities.
  const pills = [
    `${listing.bedrooms} bedroom${listing.bedrooms === 1 ? "" : "s"}`,
    `${listing.bathrooms} bathroom${listing.bathrooms === 1 ? "" : "s"}`
  ];
  // const pills = [
  //   `${listing.bedrooms} bedroom${listing.bedrooms === 1 ? "" : "s"}`,
  //   `${listing.bathrooms} bathroom${listing.bathrooms === 1 ? "" : "s"}`,
  //   ...(Array.isArray(listing.amenities_detail)
  //     ? listing.amenities_detail.slice(0, 2).map((a) => a.name)
  //     : []),
  // ];
  const landlord = listing.landlord_public ?? null;
  // Signup creates profiles with full_name='' until onboarding fills
  // it — live rows confirm ("landlord_public":{"full_name":"",...}),
  // and an empty name renders as a "?" avatar plus blank text, which
  // reads as broken. Only render the row when there's a real name.
  const landlordName = landlord?.full_name?.trim() || "Name Unknown";

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
        <div className="bg-muted relative aspect-video w-full overflow-hidden">
          <div className="absolute right-2 top-2">{listing.is_staff_verified && (
            <Badge variant="secondary" className="shrink-0 gap-1">
              <BadgeCheck className="size-3.5" />
              Verified
            </Badge>
          )}</div>
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
          {showSaveToggle && typeof listing.is_saved === "boolean" && (
            <div className="absolute top-2 right-2">
              <SaveToggle
                listingId={listing.id}
                initialSaved={listing.is_saved}
              />
            </div>
          )}

        </div>

        <CardContent className="space-y-2 py-4">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 font-medium flex-1">{listing.title}</p>
            {price && (
              <span className="text-foreground ml-auto text-sm font-medium text-right flex-1">
                {priceLabel.replace("{price}", price)}
              </span>
            )}

          </div>

          <p className="text-muted-foreground flex items-center gap-1 truncate text-xs">
            <MapPin className="size-3 shrink-0" />
            {listing.neighborhood || listing.city || "Ghana"}
          </p>

          <div className="flex flex-wrap items-center gap-1.5">
            {pills.map((pill) => (
              <Badge key={pill} variant="secondary" className="text-[10px]">
                {pill}
              </Badge>
            ))}
            {listing.advance_rent_period && listing.advance_rent_period !== "none" && (
              <Badge variant="secondary" className="text-[10px]">
                {listing.advance_rent_period === "6_months" ? "6mo advance" : "1yr advance"}
              </Badge>
            )}

          </div>

          {landlordName && (
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <span className="bg-muted flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium">
                {landlordName.charAt(0).toUpperCase()}
              </span>
              <span className="truncate">{landlordName}</span>
              {landlord?.id_verified && (
                <BadgeCheck className="size-3.5 shrink-0 text-green-600" />
              )}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
