import type { ListingCardProps } from "@/components/listing-card";

// Maps an API listing onto <ListingCard> props — shared by every place
// that shows listing cards (Discovery Hub, dashboard Listings), so the
// card reads the same data the same way everywhere. Callers add the
// state, link and actions for their surface.

export type PublicListing = {
  id: number | string;
  slug?: string;
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
  // Backend-computed and always present on real API rows, but optional
  // here so mocks/stories can omit what they don't need.
  is_saved?: boolean;
  is_staff_verified?: boolean;
  landlord_public?: { full_name: string; id_verified: boolean } | null;
  amenities_detail?: { id: number; name: string; slug: string }[];
  status?: string;
};

// Backend's ListingPhotoSerializer returns `image` as the photo URL
// field (fields = ['id', 'image', 'order', 'is_cover']) — the other two
// keys are defensive fallbacks in case that shape ever changes.
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

export function listingCardProps(
  listing: PublicListing,
): Pick<
  ListingCardProps,
  | "heading"
  | "subtitle"
  | "price"
  | "details"
  | "imageUrl"
  | "imageAlt"
  | "landlord"
  | "verified"
> {
  const photos = Array.isArray(listing.photos) ? listing.photos : [];

  const rawPrice =
    listing.listing_type === "buy" ? listing.price_one_time : listing.price_monthly;
  // NOTE: Figma labels this "GHC 4,000" but the cedi's ISO code is GHS
  // (GHC is the pre-2007 code). Card follows Figma literally so visual
  // diffs stay clean; if we ever switch, switch the detail page too.
  const price = rawPrice
    ? `GHC ${formatPrice(rawPrice)}${listing.listing_type === "buy" ? "" : "/mo"}`
    : undefined;

  // Figma details line: "2 Bedroom · 1 Bathroom" (pluralised properly
  // here). The advance period isn't in the Figma card but stays: 6-month
  // vs 1-year advance is one of paddy's two core filters.
  const details = [
    `${listing.bedrooms} Bedroom${listing.bedrooms === 1 ? "" : "s"}`,
    `${listing.bathrooms} Bathroom${listing.bathrooms === 1 ? "" : "s"}`,
    ...(listing.advance_rent_period && listing.advance_rent_period !== "none"
      ? [listing.advance_rent_period === "6_months" ? "6mo advance" : "1yr advance"]
      : []),
  ];

  const landlord = listing.landlord_public ?? null;
  // Signup creates profiles with full_name='' until onboarding fills
  // it — live rows confirm ("landlord_public":{"full_name":"",...}).
  const landlordName = landlord?.full_name?.trim() || "Name Unknown";

  return {
    heading: listing.title,
    subtitle: listing.title,
    price,
    details,
    imageUrl: photos.length > 0 ? getPhotoUrl(photos[0]) : null,
    imageAlt: listing.title,
    landlord: { name: landlordName, verified: landlord?.id_verified },
    verified: Boolean(listing.is_staff_verified),
  };
}
