// Public Property Detail page (AGENTS.md build-priority #2 —
// amenity highlights, verification badges, unlock CTA; photosphere
// tour and "Book In-Person Viewing" explicitly deferred, see note at
// bottom). Server component — same SEO reasoning as (public)/page.tsx:
// a real listing page is exactly the kind of URL organic search
// traffic lands on directly, so it needs real server-rendered HTML on
// first load, not a client-fetch shell.
//
// `is_unlocked`/`address_precise`/`landlord_contact` all come straight
// from ListingSerializer's response, already correctly gated
// server-side by the backend (_has_access) — this page trusts that
// gating completely rather than re-deriving it, matching how
// (admin)/dashboard/[user]/listings/_components/listing-preview.tsx
// also just renders whatever the API handed back.

import { cookies } from "next/headers";
import { Bed, Bath, MapPin, BadgeCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PropertyMap } from "./_components/property-map";
import { UnlockCta } from "./_components/unlock-cta";

function getPhotoUrl(photo: any): string | null {
  return photo?.image ?? photo?.image_url ?? photo?.url ?? null;
}

async function fetchListing(id: string) {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/listings/${id}/`,
    { next: { revalidate: 60 } },
  );
  if (!res.ok) return null;
  return res.json();
}

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [listing, cookieStore] = await Promise.all([
    fetchListing(id),
    cookies(),
  ]);

  // Same lightweight "is there an access_token cookie at all" check
  // (admin)/layout.tsx and dashboard/page.tsx already use server-side
  // — good enough here since this page only needs a yes/no for which
  // CTA state to render, not the user's actual identity/role.
  const isAuthenticated = Boolean(cookieStore.get("access_token")?.value);

  if (!listing) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">
          Listing not found — it may have been unpublished or removed.
        </p>
      </div>
    );
  }

  const photos: any[] = Array.isArray(listing.photos) ? listing.photos : [];
  const coverUrl = photos.length > 0 ? getPhotoUrl(photos[0]) : null;
  const price =
    listing.listing_type === "buy"
      ? listing.price_one_time
      : listing.price_monthly;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="bg-muted aspect-video w-full overflow-hidden rounded-lg border">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverUrl}
            alt={listing.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            No photos yet — this listing is still being prepared.
          </div>
        )}
        {/* 360°/photosphere tour (AGENTS.md build-priority #2) is
            deliberately NOT built here — it's an interactive
            Street-View-style viewer, a genuinely separate component
            with its own dependency, not a fit for this pass. This
            cover-photo block is the fallback the spec itself names
            for listings without one. */}
      </div>

      {photos.length > 1 && (
        <div className="grid grid-cols-4 gap-2">
          {photos.slice(1, 5).map((photo, i) => {
            const url = getPhotoUrl(photo);
            if (!url) return null;
            return (
              <div
                key={i}
                className="bg-muted aspect-square overflow-hidden rounded-md border"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`${listing.title} photo ${i + 2}`}
                  className="h-full w-full object-cover"
                />
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-bold leading-tight">{listing.title}</h1>
          {listing.is_unlocked && (
            <Badge className="shrink-0 gap-1">
              <BadgeCheck className="size-3.5" />
              Unlocked
            </Badge>
          )}
          {/* A real "staff-verified" badge (per AGENTS.md's brand
              promise — every listing is staff-visited/verified before
              going live) needs a public verification signal from the
              backend first: ListingSerializer currently excludes
              verified_by_staff entirely, and status is excluded too
              (both intentionally — see the Meta.exclude comment in
              serializers.py). Every listing reachable by this public
              page is already implicitly published/verified per
              get_queryset()'s public branch (only Status.PUBLISHED is
              visible to non-staff/non-owner requests), so omitting a
              separate "Verified" badge here isn't hiding anything —
              there's no public field yet to badge WITH. */}
        </div>

        <p className="text-muted-foreground flex items-center gap-1 text-sm">
          <MapPin className="size-4 shrink-0" />
          {listing.address_precise ||
            `${listing.neighborhood ?? ""}, ${listing.city ?? ""}`.replace(/^,\s*/, "")}
        </p>

        <div className="text-muted-foreground flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1">
            <Bed className="size-4" /> {listing.bedrooms} bed
          </span>
          <span className="flex items-center gap-1">
            <Bath className="size-4" /> {listing.bathrooms} bath
          </span>
          {price && (
            <span className="text-foreground text-lg font-semibold">
              GHS {price}
              {listing.listing_type === "rent" ? "/mo" : ""}
            </span>
          )}
          {listing.advance_rent_period && listing.advance_rent_period !== "none" && (
            <Badge variant="secondary">
              {listing.advance_rent_period === "6_months"
                ? "6 months advance"
                : "1 year advance"}
            </Badge>
          )}
        </div>
      </div>

      {listing.description && (
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {listing.description}
        </p>
      )}

      <UnlockCta
        isUnlocked={Boolean(listing.is_unlocked)}
        isAuthenticated={isAuthenticated}
      />

      <PropertyMap location={listing.location} />

      {/* "Book In-Person Viewing" CTA (AGENTS.md build-priority #2) is
          also NOT built here — per an open question flagged directly
          in AGENTS.md: whether staff-hosted viewings are still part
          of this product model now that there's no commission to
          protect is unresolved, and building this CTA would mean
          guessing at a booking flow that hasn't been confirmed with
          Kelvin yet. */}
    </div>
  );
}
