"use client";
// Saved Homes — the renter's bookmark list. Read-only here by backend
// design: saving/unsaving happens through POST/DELETE
// /listings/<id>/save/ (see SaveToggle), NOT by posting to this
// endpoint. SavedListingViewSet is list-only and renter-scoped
// (non-renters get an empty list, not an error).

import { useApiList } from "@/hooks/use-api";
import { useMe } from "@/hooks/use-auth";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Bed, Bath, MapPin } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

// Same defensive photo reading as the listings/leases pages — the
// nested listing_detail is a full ListingSerializer payload, whose
// photos array carries ListingPhoto objects ({image, order, is_cover}).
function getPhotoUrl(photo: any): string | null {
  return photo?.image ?? photo?.image_url ?? photo?.url ?? null;
}

export default function SavedHomesPage() {
  const params = useParams<{ user: string }>();
  const userId = params.user;
  const { data: identity } = useMe();
  const role: string | undefined = identity?.role;

  // GET /listings/saved/ — the resource name carries the full backend
  // path, same as before. Read-only: SavedListingViewSet has no
  // retrieve route, so only the list is used.
  const { data, isLoading, isError } = useApiList("listings/saved");

  // Non-renters have no saved-homes list (backend returns empty for
  // them too) — say so plainly instead of rendering a forever-empty page.
  if (role !== undefined && role !== "renter") {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">
          Saved Homes is a renter feature — landlords manage their
          properties under{" "}
          <Link
            href={`/dashboard/${userId}/listings`}
            className="text-indigo-600 underline"
          >
            Listings
          </Link>
          .
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <p>Loading saved homes...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <p className="text-red-500">Failed to load saved homes.</p>
      </div>
    );
  }

  const saved: any[] = data?.data ?? [];

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold">Saved Homes</h1>

      {saved.length === 0 ? (
        <p className="text-muted-foreground">
          Nothing saved yet — tap the heart on any listing to keep it
          here for later.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {saved.map((row: any) => {
            // listing_detail is the nested full listing — the whole
            // reason this page needs no per-row second fetch.
            const listing: any = row.listing_detail ?? {};
            const photos: any[] = Array.isArray(listing.photos)
              ? listing.photos
              : [];
            const coverUrl =
              photos.length > 0 ? getPhotoUrl(photos[0]) : null;
            return (
              <Link key={row.id} href={`/homes/${listing.id ?? row.listing}`}>
                <Card className="cursor-pointer overflow-hidden py-0 transition hover:shadow-md">
                  <div className="bg-muted aspect-video w-full overflow-hidden">
                    {coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={coverUrl}
                        alt={listing.title ?? "Saved listing"}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
                        No photo yet
                      </div>
                    )}
                  </div>
                  <CardContent className="space-y-2 py-4">
                    <p className="truncate font-medium">
                      {listing.title ?? `Listing #${row.listing}`}
                    </p>
                    <p className="text-muted-foreground flex items-center gap-1 truncate text-xs">
                      <MapPin className="size-3 shrink-0" />
                      {listing.neighborhood ||
                        listing.city ||
                        "No location yet"}
                    </p>
                    <div className="text-muted-foreground flex items-center gap-3 text-xs">
                      <span className="flex items-center gap-1">
                        <Bed className="size-3" /> {listing.bedrooms}
                      </span>
                      <span className="flex items-center gap-1">
                        <Bath className="size-3" /> {listing.bathrooms}
                      </span>
                      {listing.price_monthly && (
                        <span className="text-foreground ml-auto font-medium">
                          GHS {listing.price_monthly}/mo
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
