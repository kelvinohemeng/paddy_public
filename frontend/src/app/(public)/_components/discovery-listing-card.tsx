"use client";

import Link from "next/link";
import { BadgeCheck } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FavoriteButton } from "@/components/favorite-button";
import { cn } from "@/lib/utils";

// Backend's ListingPhotoSerializer returns `image` as the photo URL
// field (fields = ['id', 'image', 'order', 'is_cover']) — the other
// two keys here are defensive fallbacks only, in case that shape
// ever changes.
function getPhotoUrl(photo: any): string | null {
  return photo?.image ?? photo?.image_url ?? photo?.url ?? null;
}

// DRF sends DecimalFields as strings ("4000.00"); Figma shows "4,000".
// Thousands separators, and pesewas only when there are any.
function formatPrice(raw: string): string {
  const amount = Number(raw);
  if (!Number.isFinite(amount)) return raw;
  return amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
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
  // Figma "Favorite" heart (States Default/Saved). Omitted → no heart
  // at all (landlords/staff can't save; stories can opt out). State
  // and the request live in useSavedListings — the card only renders.
  favorite?: { saved: boolean; onToggle: () => void };
};

// Figma "Listing Card" (component set 175:21077, States Default and
// Saved): grey rounded photo with the heart top-right; below it a
// two-column row — "{Rent|Buy} in {area}" heading, listing title,
// detail pills and the landlord line on the left, price on the right.
// Leased/Property states belong to the dashboards, not discovery.
export function DiscoveryListingCard({
  listing,
  isHovered,
  onHover,
  favorite,
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

  const area = listing.neighborhood || listing.city || "Ghana";
  const heading = `${listing.listing_type === "buy" ? "Buy" : "Rent"} in ${area}`;

  // Figma body pills: "1 bedroom" / "1 bathroom" / one amenity ("Pool").
  // The advance-period pill isn't in the Figma card but stays: 6-month
  // vs 1-year advance is one of paddy's two core filters.
  const pills = [
    `${listing.bedrooms} bedroom${listing.bedrooms === 1 ? "" : "s"}`,
    `${listing.bathrooms} bathroom${listing.bathrooms === 1 ? "" : "s"}`,
    ...(Array.isArray(listing.amenities_detail)
      ? listing.amenities_detail.slice(0, 1).map((a) => a.name)
      : []),
    ...(listing.advance_rent_period && listing.advance_rent_period !== "none"
      ? [listing.advance_rent_period === "6_months" ? "6mo advance" : "1yr advance"]
      : []),
  ];

  const landlord = listing.landlord_public ?? null;
  // Signup creates profiles with full_name='' until onboarding fills
  // it — live rows confirm ("landlord_public":{"full_name":"",...}).
  const landlordName = landlord?.full_name?.trim() || "Name Unknown";

  return (
    <Link
      href={`/homes/${listing.id}`}
      id={`listing-card-${listing.id}`}
      onMouseEnter={() => onHover(listing.id)}
      onMouseLeave={() => onHover(null)}
      className="group block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black"
    >
      <Card
        className={cn(
          "h-full gap-3 overflow-visible rounded-none border-none py-0 shadow-none transition-transform duration-200",
          // Mirrors DiscoveryMap's hovered-pin highlight — hovering
          // EITHER the card or its map marker lifts the card, so the
          // split-pane reads as one connected view.
          isHovered && "-translate-y-1",
        )}
      >
        <div className="bg-muted relative aspect-[17/16] w-full overflow-hidden rounded-xl">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverUrl}
              alt={listing.title}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
              No photo yet
            </div>
          )}
          {/* Staff verification is the brand promise, so it stays on
              the photo — top-LEFT, clear of Figma's heart. */}
          {listing.is_staff_verified && (
            <Badge
              variant="secondary"
              className="absolute top-2.5 left-2.5 gap-1 bg-white/90 shadow-sm"
            >
              <BadgeCheck className="size-3.5" />
              Verified
            </Badge>
          )}
          {favorite && (
            <FavoriteButton
              saved={favorite.saved}
              onToggle={favorite.onToggle}
              className="absolute top-1.5 right-1.5"
            />
          )}
        </div>

        <CardContent className="flex items-start justify-between gap-3 px-0">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate text-lg leading-tight font-medium tracking-tight text-black/80 md:text-base">
              {heading}
            </p>
            <p className="truncate text-xs font-medium text-black/80">
              {listing.title}
            </p>
            <div className="flex flex-wrap gap-1 pt-0.5">
              {pills.map((pill) => (
                <span
                  key={pill}
                  className="bg-muted rounded-[4px] px-1.5 py-1 text-[11px] leading-none font-medium text-black/80"
                >
                  {pill}
                </span>
              ))}
            </div>
            <p className="flex items-center gap-1.5 pt-2 text-xs font-medium text-black/80">
              <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full border bg-neutral-100 text-[9px] text-black/60">
                {landlordName.charAt(0).toUpperCase()}
              </span>
              <span className="truncate">{landlordName}</span>
              {landlord?.id_verified && (
                <BadgeCheck
                  className="size-3.5 shrink-0 fill-black text-white"
                  aria-label="ID verified landlord"
                />
              )}
            </p>
          </div>
          {price && (
            <p className="shrink-0 text-right text-lg leading-tight font-medium tracking-tight whitespace-nowrap text-black/80 md:text-base">
              {priceLabel.replace("{price}", formatPrice(price))}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
