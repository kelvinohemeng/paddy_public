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
// Link, not <a> — Next.js's client-side navigation component. Using
// it (instead of a plain anchor tag) is what makes the intercepting
// routes below actually trigger as MODALS instead of full page
// reloads. A hard navigation (typing the URL directly, or a plain <a>)
// bypasses interception entirely and renders the real full page.

import { ListingCard } from "@/components/listing-card";
import { listingCardProps } from "@/lib/listing-card-data";
import { ListingGrid } from "@/components/listing-grid";
import { SubscriptionCard } from "./_components/subscription-card";
import {
  STATUS_BADGE_STATE,
  STATUS_META,
  parseStatus,
} from "@/lib/listing-status";

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
        <ListingGrid>
          {listings.map((listing: any) => {
            const status = parseStatus(listing.status);
            return (
              // Same card as the Discovery Hub, in its Property state
              // (the landlord's own listing: no heart, lifecycle badge).
              // No action button — the whole card links to
              // /dashboard/[user]/listings/[id], which the
              // @modal/(.)dashboard/[user]/listings/[id] intercepted
              // route opens in the preview drawer (Update / Archive /
              // Submit live there); a direct visit or refresh lands on
              // the full-page listings/[id]/page.tsx.
              <ListingCard
                key={listing.id}
                {...listingCardProps(listing)}
                state="property"
                href={`/dashboard/${userId}/listings/${listing.id}`}
                status={
                  status
                    ? {
                        label: STATUS_META[status].label,
                        state: STATUS_BADGE_STATE[status],
                      }
                    : undefined
                }
                action={null}
              />
            );
          })}
        </ListingGrid>
      )}
    </div>
  );
}
