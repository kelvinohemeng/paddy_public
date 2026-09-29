"use client";
// Required — useApiList (below) is a client-side hook. Next.js's App
// Router treats every file as a SERVER component unless this directive
// is present, and a server component can't call a client hook at all.

import { useApiList } from "@/hooks/use-api";
import { useMe } from "@/hooks/use-auth";
import { useParams } from "next/navigation";

import { ListingCard } from "@/components/listing-card";
import { listingCardProps } from "@/lib/listing-card-data";
import { ListingGrid } from "@/components/listing-grid";
import {
  DashboardEmptyState,
  DashboardLinkButton,
  DashboardMessage,
  DashboardPage,
} from "@/components/dashboard-page";
import {
  STATUS_BADGE_STATE,
  STATUS_META,
  parseStatus,
} from "@/lib/listing-status";

// "My Property" — the landlord's own listings. Figma 181:22561 (with
// listings) and 181:22625 ("No Property", empty), read 2026-09-28.
//
// The plan / subscription card used to sit above this grid. The frames
// have no room for it, and their nav has a "Payment" row, so it moved to
// /dashboard/[user]/payment (see payment/page.tsx).

export default function ListingsPage() {
  const params = useParams<{ user: string }>();
  const userId = params.user;
  const { data: identity } = useMe();
  const role: string | undefined = identity?.role;

  // GET /listings/?mine=true (backend PR #16): ONLY this landlord's own
  // listings, any status — instead of the default own-UNION-published
  // mix. This is a management view, not a browse view.
  const { data, isLoading, isError } = useApiList("listings", {
    filters: [{ field: "mine", value: "true" }],
  });

  const createHref = `/dashboard/${userId}/listings/create`;

  // Listing management is landlord-only in the nav. Other roles reach
  // this URL only by typing it: point them somewhere useful instead. The
  // backend would 403 any actual write anyway.
  if (role !== undefined && role !== "landlord") {
    return (
      <DashboardEmptyState
        title="Listings are for landlords"
        description={
          role === "renter"
            ? "Your tenancies live under Active Lease."
            : "Listings waiting for verification are in the review queue."
        }
        action={
          <DashboardLinkButton
            href={
              role === "renter"
                ? `/dashboard/${userId}/leases`
                : `/dashboard/${userId}/reviews`
            }
          >
            {role === "renter" ? "Go to Active Lease" : "Open the review queue"}
          </DashboardLinkButton>
        }
      />
    );
  }

  if (isLoading) {
    return <DashboardMessage loading>Loading your properties…</DashboardMessage>;
  }

  if (isError) {
    // A visible failure, rather than an empty grid that would look the
    // same as "no listings yet".
    return (
      <DashboardMessage tone="error">
        Couldn&apos;t load your properties. Refresh to try again.
      </DashboardMessage>
    );
  }

  const listings: any[] = data?.data ?? [];

  if (listings.length === 0) {
    return (
      <DashboardEmptyState
        title="You have no property"
        description="Create one"
        action={
          // The frame's button says "Discover New Homes" (copied from the
          // renter frame); for a landlord the next step is adding a home.
          <DashboardLinkButton href={createHref}>Add a new property</DashboardLinkButton>
        }
      />
    );
  }

  return (
    <DashboardPage
      title="My Property"
      action={
        // A Link (DashboardLinkButton renders one), so it opens the create
        // drawer through the @modal/(.)dashboard/[user]/listings/create
        // intercepting route. Primary Base (32), as in the frame.
        <DashboardLinkButton href={createHref}>Add a new property</DashboardLinkButton>
      }
    >
      <ListingGrid className="gap-x-6 gap-y-[30px]">
        {listings.map((listing: any) => {
          const status = parseStatus(listing.status);
          return (
            // Property state: the landlord's own listing — no heart, a
            // lifecycle badge. No action button: the whole card links to
            // /dashboard/[user]/listings/[id], which the intercepted route
            // opens in the preview drawer (Update / Archive / Submit live
            // there); a direct visit lands on the full-page version.
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
    </DashboardPage>
  );
}
