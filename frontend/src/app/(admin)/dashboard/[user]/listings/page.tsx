"use client";
// Required — useList (below) is a client-side hook (manages state,
// re-fetches reactively in the browser). Next.js's App Router treats
// every file as a SERVER component by default unless this directive
// is present, and a server component genuinely cannot call a client
// hook at all — this is a hard runtime error, not a style choice.

import { useApiList } from "@/hooks/use-api";
import { useMe } from "@/hooks/use-auth";
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
import { SubscriptionCard } from "./_components/subscription-card";
import { STATUS_META, parseStatus } from "@/lib/listing-status";

// Same lifecycle flag as listing-preview.tsx — LIVE since backend PR #16
// exposed `status` on ListingSerializer. Duplicated literal, deliberate:
// importing a flag from a component file would couple list page ->
// preview component for one boolean.
const LIFECYCLE_UI_ENABLED = true;

// Same defensive photo-field reading as listing-preview.tsx — backend
// shape for ListingPhoto isn't pinned down from the frontend alone.
function getPhotoUrl(photo: any): string | null {
  return photo?.image ?? photo?.image_url ?? photo?.url ?? null;
}

export default function ListingsPage() {
  const params = useParams<{ user: string }>();
  const userId = params.user;
  const { data: identity } = useMe();
  const role: string | undefined = identity?.role;

  // GET /listings/?mine=true (backend PR #16): ONLY this landlord's own
  // listings, any status — instead of the default own-UNION-published
  // mix. The dashboard is a management view, not a browse view; before
  // this param existed the grid mixed in every other landlord's
  // published listings AND the subscription-cap count below read
  // high. Filters append verbatim as query params, so this arrives as
  // &mine=true.
  //
  // Refine v5 nested the return as { query, result }; the plain
  // useQuery replacement returns { data, isLoading, isError } flat.
  // (The old { field, operator, value } filter shape is now just
  // { field, value } — the operator was never sent to the backend.)
  const { data, isLoading, isError } = useApiList("listings", {
    filters: [
      // ?mine=true (backend PR #16): ONLY this landlord's own listings,
      // any status — instead of the default own-UNION-published mix.
      // The dashboard is a management view, not a browse view; before
      // this param existed the grid mixed in every other landlord's
      // published listings AND the subscription-cap count below read
      // high. Filters append verbatim as query params, so this arrives
      // as &mine=true.
      { field: "mine", value: "true" },
    ],
  });

  if (isLoading) {
    return <p className="p-6">Loading listings...</p>;
  }

  if (isError) {
    // A real, visible failure state — worth having explicitly rather
    // than letting a failed fetch render a silently empty list, which
    // would be indistinguishable from "zero listings exist yet"
    return <p className="p-6 text-red-500">Failed to load listings.</p>;
  }

  const listings = data?.data ?? [];
  // data.data — the actual array of listings. data.total also
  // exists here for pagination, unused for now since this is a first
  // pass at just proving the create flow works end to end.

  // Listing management is landlord/staff-only (renters reach this URL
  // only by typing it — the layout gate lets all roles through and the
  // sidebar hides this entry for renters). Render a pointer, not the
  // management UI; the backend would 403 any actual write anyway.
  if (role === "renter") {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">
          Listing management is for landlords — your tenancies live under{" "}
          <Link
            href={`/dashboard/${userId}/leases`}
            className="text-indigo-600 underline"
          >
            Leases
          </Link>
          .
        </p>
      </div>
    );
  }

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

      {/* Subscription surface (AGENTS.md: landlords need to see their
          tier/cap "sooner than post-MVP" now that subscriptions gate
          listing creation). Lives BELOW the header/CTA so the primary
          task (listings) stays first in reading order.

          listingsUsed = listings.length is now EXACT: the ?mine=true
          filter above scopes this list to the landlord's own rows (any
          status), which is precisely the population the backend's
          perform_create cap counts (every listing, regardless of
          status — an abandoned draft burns a free-tier slot, which the
          card's usage bar now makes visible). */}
      <div className="mb-6 max-w-md">
        <SubscriptionCard userId={userId} listingsUsed={listings.length} />
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
                      {/* Was a dead {listing.status && <Badge>...} — the
                          serializer excludes status so the key never
                          arrives. Flag-gated StatusBadge now; lights up
                          with the preview's when Task 2a lands. */}
                      {LIFECYCLE_UI_ENABLED &&
                        (() => {
                          const status = parseStatus(listing.status);
                          if (!status) return null;
                          const meta = STATUS_META[status];
                          const Icon = meta.icon;
                          return (
                            <Badge
                              variant={meta.badgeVariant}
                              className="shrink-0 gap-1"
                            >
                              <Icon className="size-3" />
                              {meta.label}
                            </Badge>
                          );
                        })()}
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
