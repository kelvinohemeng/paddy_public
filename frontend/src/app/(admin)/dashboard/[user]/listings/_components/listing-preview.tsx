"use client";

import { useOne, useList } from "@refinedev/core";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { MapPin, Bed, Bath, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DeleteButton } from "@/components/refine-ui/buttons/delete";

// Shared preview body for a single listing — rendered by BOTH:
//   1. @modal/(.)dashboard/[user]/listings/[id]/page.tsx — docked panel
//   2. dashboard/[user]/listings/[id]/page.tsx           — full-page fallback
// Same "one component, two chrome wrappers" pattern as
// ListingCreateForm/listing-create-form.tsx, for the same reason: the
// actual preview markup/data-fetching logic must never exist twice.

type ListingPreviewProps = {
  listingId: string | number;
  // Optional — lets the docked panel close/navigate itself without this
  // component needing to know which chrome it's rendered inside.
  onEdit?: () => void;
};

// Backend's ListingPhotoSerializer returns `image` as the photo URL
// field (fields = ['id', 'image', 'order', 'is_cover']) — the other
// two keys here are defensive fallbacks only, in case that shape
// ever changes.
function getPhotoUrl(photo: any): string | null {
  return photo?.image ?? photo?.image_url ?? photo?.url ?? null;
}

export function ListingPreview({ listingId, onEdit }: ListingPreviewProps) {
  const router = useRouter();
  const params = useParams<{ user: string }>();
  const userId = params.user;

  const { result, query } = useOne({
    resource: "listings",
    id: listingId,
  });

  const listing = result as any;

  // Amenities on the listing come back as a list of ids (see
  // listing-create-form.tsx's AmenityPicker notes) — resolve their
  // names via the same shared core/amenities resource, rather than
  // assuming the listing response embeds full amenity objects.
  const amenityIds: number[] = Array.isArray(listing?.amenities)
    ? listing.amenities.map((a: any) => (typeof a === "object" ? a.id : a))
    : [];

  const { result: amenitiesResult } = useList({
    resource: "core/amenities",
    pagination: { currentPage: 1, pageSize: 999 },
    queryOptions: { enabled: amenityIds.length > 0 },
  });

  const amenityNames = (amenitiesResult?.data ?? [])
    .filter((a: any) => amenityIds.includes(a.id))
    .map((a: any) => a.name);

  const photos: any[] = Array.isArray(listing?.photos) ? listing.photos : [];
  const coverUrl = photos.length > 0 ? getPhotoUrl(photos[0]) : null;

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
      </div>
    );
  }

  if (query.isError || !listing) {
    return (
      <p className="text-red-500 p-4 text-sm">
        Couldn&apos;t load this listing.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-muted aspect-video w-full overflow-hidden rounded-md border">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverUrl}
            alt={listing.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            No photos yet
          </div>
        )}
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

      <div className="space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-semibold leading-tight">
            {listing.title}
          </h2>
          {listing.status && (
            <Badge
              variant={listing.status === "published" ? "default" : "secondary"}
              className="shrink-0"
            >
              {listing.status}
            </Badge>
          )}
        </div>

        <p className="text-muted-foreground flex items-center gap-1 text-sm">
          <MapPin className="size-3.5 shrink-0" />
          {listing.address_precise || `${listing.neighborhood ?? ""} ${listing.city ?? ""}`.trim() || "No address yet"}
        </p>

        <div className="text-muted-foreground flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1">
            <Bed className="size-3.5" /> {listing.bedrooms} bd
          </span>
          <span className="flex items-center gap-1">
            <Bath className="size-3.5" /> {listing.bathrooms} ba
          </span>
          {listing.price_monthly && (
            <span className="font-medium text-foreground">
              GHS {listing.price_monthly}/mo
            </span>
          )}
        </div>
      </div>

      {listing.description && (
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {listing.description}
        </p>
      )}

      {amenityNames.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {amenityNames.map((name: string) => (
            <Badge key={name} variant="secondary">
              {name}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex gap-2 border-t pt-4">
        {onEdit ? (
          <Button type="button" onClick={onEdit} className="flex-1">
            Edit Listing
          </Button>
        ) : (
          <Link href={`/dashboard/${userId}/listings/${listingId}/edit`} className="flex-1">
            <Button type="button" className="w-full">
              Edit Listing
            </Button>
          </Link>
        )}
        <DeleteButton
          resource="listings"
          recordItemId={listingId}
          variant="outline"
          onSuccess={() => router.push(`/dashboard/${userId}/listings`)}
          // Without this, a successful delete leaves whichever panel/page
          // was showing THIS listing still mounted — it just refetches
          // via useOne and falls into the "Couldn't load this listing"
          // error state instead of actually closing. router.push (not
          // router.back()) is deliberate: after a delete there's no
          // "back" state worth returning to, the listing is gone either
          // way, so this always lands on the real list.
        />
      </div>
    </div>
  );
}
