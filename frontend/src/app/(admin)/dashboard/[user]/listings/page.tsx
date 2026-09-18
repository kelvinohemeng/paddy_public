"use client";
// Required — useList (below) is a client-side hook (manages state,
// re-fetches reactively in the browser). Next.js's App Router treats
// every file as a SERVER component by default unless this directive
// is present, and a server component genuinely cannot call a client
// hook at all — this is a hard runtime error, not a style choice.

import { useList } from "@refinedev/core";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Bed, Bath, MapPin } from "lucide-react";
// Link, not <a> — Next.js's client-side navigation component. Using
// it (instead of a plain anchor tag) is what makes the intercepting
// routes below actually trigger as MODALS instead of full page
// reloads. A hard navigation (typing the URL directly, or a plain <a>)
// bypasses interception entirely and renders the real full page.

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Same defensive photo-field reading as listing-preview.tsx — backend
// shape for ListingPhoto isn't pinned down from the frontend alone.
function getPhotoUrl(photo: any): string | null {
  return photo?.image ?? photo?.image_url ?? photo?.url ?? null;
}

export default function ListingsPage() {
  const params = useParams<{ user: string }>();
  const userId = params.user;

  // useList — Refine's generic "fetch a list of a resource" hook. It
  // reads the CURRENT route to infer resource="listings" (matching
  // the "listings" resource registered in _refine_context.tsx, whose
  // `list` route is "/dashboard/:user/listings" — Refine matches on
  // the route PATTERN, so this still resolves correctly even though
  // the actual URL has a real user id in place of ":user"), then
  // internally calls dataProvider.getList({ resource: "listings" }) —
  // the exact same generic function you wrote by hand earlier, with
  // zero listings-specific code inside it.
  //
  // Refine v5 nests the return value as { query, result } rather than
  // the flatter { data, isLoading, isError } shape older docs/examples
  // show (a real breaking change between major versions) — confirmed
  // against this project's actual installed @refinedev/core version
  // via a real TypeScript error, not assumed from memory.
  const { query, result } = useList({
    resource: "listings",
  });

  if (query.isLoading) {
    return <p className="p-6">Loading listings...</p>;
  }

  if (query.isError) {
    // A real, visible failure state — worth having explicitly rather
    // than letting a failed fetch render a silently empty list, which
    // would be indistinguishable from "zero listings exist yet"
    return <p className="p-6 text-red-500">Failed to load listings.</p>;
  }

  const listings = result?.data ?? [];
  // result.data — the actual array of listings. result.total also
  // exists here for pagination, unused for now since this is a first
  // pass at just proving the create flow works end to end.

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Listings</h1>

        <Link
          href={`/dashboard/${userId}/listings/create`}
          className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          New Listing
        </Link>
        {/* This Link's href is the SAME URL Refine's "listings"
            resource registration points "create" at (with :user
            resolved to the real id). Nothing about the URL changes
            because of the modal pattern — what changes is HOW
            Next.js decides to render whatever's at that URL, based on
            whether navigation happened via this Link (client-side,
            intercepted -> modal) or a hard refresh/direct visit
            (full page, see the create/page.tsx fallback below) */}
      </div>

      {listings.length === 0 ? (
        <p className="text-muted-foreground">
          No listings yet — create your first one to get started.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((listing: any) => {
            const photos: any[] = Array.isArray(listing.photos)
              ? listing.photos
              : [];
            const coverUrl =
              photos.length > 0 ? getPhotoUrl(photos[0]) : null;

            return (
              // Link, not onClick — clicking the WHOLE card navigates
              // to /dashboard/[user]/listings/[id], which the
              // @modal/(.)dashboard/[user]/listings/[id] intercepted
              // route turns into the docked preview panel (same
              // interception pattern "New Listing" above relies on).
              // A direct visit/refresh instead lands on the real
              // full-page fallback at listings/[id]/page.tsx.
              <Link
                key={listing.id}
                href={`/dashboard/${userId}/listings/${listing.id}`}
              >
                <Card className="cursor-pointer overflow-hidden py-0 transition hover:shadow-md">
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
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate font-medium">{listing.title}</p>
                      {listing.status && (
                        <Badge
                          variant={
                            listing.status === "published"
                              ? "default"
                              : "secondary"
                          }
                          className="shrink-0"
                        >
                          {listing.status}
                        </Badge>
                      )}
                    </div>

                    <p className="text-muted-foreground flex items-center gap-1 truncate text-xs">
                      <MapPin className="size-3 shrink-0" />
                      {listing.neighborhood || listing.city || "No location yet"}
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
