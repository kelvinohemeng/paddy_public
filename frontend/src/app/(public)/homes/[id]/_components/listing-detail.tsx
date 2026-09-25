"use client";

import { useRef, useState } from "react";
import { BadgeCheck, MapPin, Share2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { FavoriteButton } from "@/components/favorite-button";
import { useSavedListings } from "@/hooks/use-saved-listings";
import { BookingCard, TrustNote, type LandlordContact } from "./booking-card";
import { PhotoGallery } from "./photo-gallery";
import { PropertyMap } from "./property-map";

// Backend's ListingPhotoSerializer returns `image`; the other keys are
// defensive fallbacks (same helper as the discovery card).
function getPhotoUrl(photo: any): string | null {
  return photo?.image ?? photo?.image_url ?? photo?.url ?? null;
}

function formatPrice(raw: string): string {
  const amount = Number(raw);
  if (!Number.isFinite(amount)) return raw;
  return amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export type DetailListing = {
  id: number | string;
  slug?: string;
  title: string;
  description?: string | null;
  city?: string | null;
  neighborhood?: string | null;
  bedrooms: number;
  bathrooms: number;
  listing_type: "rent" | "buy";
  price_monthly?: string | null;
  price_one_time?: string | null;
  advance_rent_period?: string | null;
  location?: string | null;
  photos?: any[];
  is_unlocked?: boolean;
  is_staff_verified?: boolean;
  address_precise?: string | null;
  landlord_contact?: LandlordContact;
  landlord_public?: { full_name: string; id_verified: boolean } | null;
  amenities_detail?: { id: number; name: string; slug: string }[];
};

// Figma "Property Details" (section 170:1917, panel 171:2624). One
// component for both surfaces: the Discovery Hub's preview drawer and
// the full /homes/[id] page (Figma's "Expanded" frame).
//
// Deliberately omitted for now (no backend data yet): Take Live Tour
// (photosphere — build-priority #2, separate component), the landlord's
// response rate and photo, and the map's "Find Places" search.
export function ListingDetail({
  listing,
  isAuthenticated,
}: {
  listing: DetailListing;
  isAuthenticated: boolean;
}) {
  const bookingRef = useRef<HTMLDivElement>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const { mode: favoriteMode, isSaved, toggle } = useSavedListings();

  const photos = (Array.isArray(listing.photos) ? listing.photos : [])
    .map(getPhotoUrl)
    .filter((url): url is string => Boolean(url));

  const rawPrice =
    listing.listing_type === "buy" ? listing.price_one_time : listing.price_monthly;
  // Figma: "GHC 4,000/ month". Card and detail both say GHC to match
  // the design (the ISO code is GHS — see discovery-listing-card.tsx).
  const priceLabel = rawPrice
    ? `GHC ${formatPrice(rawPrice)}${listing.listing_type === "rent" ? "/ month" : ""}`
    : null;

  const area = listing.neighborhood || listing.city || "Ghana";
  const areaLine = [listing.neighborhood, listing.city].filter(Boolean).join(", ");
  const isUnlocked = Boolean(listing.is_unlocked);
  const landlordName = listing.landlord_public?.full_name?.trim() || "Name Unknown";
  const landlordVerified = Boolean(listing.landlord_public?.id_verified);

  const pills = [
    `${listing.bedrooms} bedroom${listing.bedrooms === 1 ? "" : "s"}`,
    `${listing.bathrooms} bathroom${listing.bathrooms === 1 ? "" : "s"}`,
    ...(listing.amenities_detail ?? []).map((a) => a.name),
  ];

  // Both "Message Landlord" buttons land here. Locked → point at the
  // unlock (the only way to get the landlord's direct line). Unlocked
  // → reveal phone/email inside the booking card.
  function messageLandlord() {
    bookingRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (!isUnlocked) {
      bookingRef.current?.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.03)" }, { transform: "scale(1)" }],
        { duration: 450, easing: "ease-out" },
      );
      toast("Unlock this listing to contact the landlord directly.", {
        description: "You'll get their phone number and email right away.",
      });
      return;
    }
    setContactOpen((open) => !open);
  }

  async function share() {
    const url = `${window.location.origin}/homes/${listing.slug ?? listing.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: listing.title, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied");
      }
    } catch {
      // User dismissed the share sheet — nothing to report.
    }
  }

  return (
    <article className="mx-auto w-full max-w-[845px] px-5 pb-16 md:px-8">
      {/* Title row */}
      <div className="animate-in fade-in slide-in-from-bottom-2 flex items-end justify-between gap-4 duration-500">
        <h1 className="text-2xl leading-tight font-medium tracking-tight text-black/80">
          {listing.title}
        </h1>
        <div className="flex shrink-0 items-center gap-1">
          {favoriteMode !== "hidden" && (
            <FavoriteButton
              saved={isSaved(listing.id)}
              onToggle={() => toggle(listing.id)}
            />
          )}
          <button
            type="button"
            onClick={share}
            aria-label="Share this home"
            className="inline-flex size-9 items-center justify-center rounded-full text-black transition hover:scale-110 hover:bg-zinc-100 active:scale-95"
          >
            <Share2 className="size-5" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="animate-in fade-in slide-in-from-bottom-3 mt-6 duration-500 [animation-delay:60ms] [animation-fill-mode:both]">
        <PhotoGallery urls={photos} title={listing.title} />
      </div>

      {/* Two columns: details left, sticky booking card right */}
      <div className="mt-10 grid gap-10 md:grid-cols-[minmax(0,1fr)_290px] md:gap-12 md:px-8">
        <div className="animate-in fade-in slide-in-from-bottom-3 min-w-0 space-y-8 duration-500 [animation-delay:120ms] [animation-fill-mode:both]">
          <section className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[22px] leading-tight font-medium tracking-tight text-black/80">
                {listing.listing_type === "buy" ? "Buy" : "Rent"} in {area}
              </h2>
              {listing.is_staff_verified && (
                <Badge variant="secondary" className="gap-1">
                  <BadgeCheck className="size-3.5" />
                  Verified by paddy
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {pills.map((pill) => (
                <span
                  key={pill}
                  className="rounded-[5px] bg-[#f2f2f2] px-1.5 py-1 text-[11px] leading-none font-medium text-black/80"
                >
                  {pill}
                </span>
              ))}
            </div>
            <p className="flex items-center gap-1.5 pt-1 text-xs font-medium text-black/80">
              <span className="flex size-[18px] items-center justify-center rounded-full border bg-neutral-100 text-[9px] text-black/60">
                {landlordName.charAt(0).toUpperCase()}
              </span>
              {landlordName}
              {landlordVerified && (
                <BadgeCheck className="size-3.5 fill-black text-white" aria-label="ID verified" />
              )}
            </p>
            <p className="flex items-start gap-1.5 text-xs text-black/60">
              <MapPin className="mt-px size-3.5 shrink-0" />
              {isUnlocked && listing.address_precise
                ? listing.address_precise
                : `${areaLine || area} · exact address unlocks after payment`}
            </p>
          </section>

          {listing.description && (
            <section className="space-y-2.5">
              <h3 className="text-[11px] font-medium text-black/50">About this property</h3>
              <p className="text-[13px] leading-[1.6] whitespace-pre-wrap text-black/80">
                {listing.description}
              </p>
            </section>
          )}

          <section className="space-y-3">
            <h3 className="text-[22px] leading-tight font-medium tracking-tight text-black/80">
              Meet your landlord
            </h3>
            <div className="inline-flex max-w-full items-center gap-4 rounded-xl bg-white p-5 shadow-[0_4px_27.6px_3px_rgba(0,0,0,0.1)]">
              <div className="flex aspect-[66/78] w-[90px] shrink-0 items-center justify-center rounded-[7px] bg-[#c6c6c6] text-3xl font-medium text-white">
                {landlordName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 space-y-5">
                <div className="space-y-1">
                  <p className="truncate text-lg font-medium tracking-tight text-black/80">
                    {landlordName}
                  </p>
                  {landlordVerified && (
                    <p className="flex items-center gap-1 text-[11px] font-medium text-black/80">
                      Verified landlord
                      <BadgeCheck className="size-3.5 fill-black text-white" />
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={messageLandlord}
                  className="rounded-md bg-zinc-800 px-2.5 py-1 text-[13px] font-medium text-white/90 shadow-[0_1px_2px_rgba(0,0,0,0.4),0_0_0_1px_#18181b] transition hover:bg-zinc-900 active:scale-[0.97]"
                >
                  Message landlord
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* Mobile: booking card right after the gallery, so price and
            the unlock action are above the fold. Desktop: sticky right. */}
        <aside className="animate-in fade-in slide-in-from-bottom-3 order-first duration-500 [animation-delay:180ms] [animation-fill-mode:both] md:sticky md:top-6 md:order-none md:self-start">
          <BookingCard
            ref={bookingRef}
            listingId={listing.id}
            priceLabel={priceLabel}
            advancePeriod={listing.advance_rent_period ?? null}
            isUnlocked={isUnlocked}
            isAuthenticated={isAuthenticated}
            contact={listing.landlord_contact ?? null}
            contactOpen={contactOpen}
            onMessageLandlord={messageLandlord}
          />
        </aside>
      </div>

      {listing.location && (
        <section className="mt-12 space-y-3 md:px-8">
          <h3 className="text-[22px] leading-tight font-medium tracking-tight text-black/80">
            Where you&apos;ll be
          </h3>
          <PropertyMap
            location={listing.location}
            approximate={!isUnlocked}
            className="h-[350px] rounded-2xl"
          />
          {!isUnlocked && (
            <p className="text-xs text-black/50">
              Approximate area. The exact location unlocks with the landlord&apos;s contact.
            </p>
          )}
        </section>
      )}

      <TrustNote className="mx-auto mt-12 hidden md:flex" />
    </article>
  );
}
