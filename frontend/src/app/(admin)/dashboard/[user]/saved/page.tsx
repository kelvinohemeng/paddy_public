"use client";
// Saved Homes — the renter's shortlist. Figma 175:20857 (with homes) and
// 175:21179 ("No Saved Homes"), read 2026-09-28: the shared Listing Card
// in its Saved state (solid heart, landlord row), three to a row.
//
// Reads GET /listings/saved/ (SavedListingViewSet: list-only and
// renter-scoped; non-renters get an empty list, not an error). Each row
// nests the full listing as `listing_detail`, so no per-card fetch.
// Unsaving goes through useSavedListings — the same hook the Discovery
// Hub's hearts use — which updates this list optimistically, so the card
// leaves the grid as soon as the heart is tapped.

import { useApiList } from "@/hooks/use-api";
import { useMe } from "@/hooks/use-auth";
import { useSavedListings } from "@/hooks/use-saved-listings";
import { useParams } from "next/navigation";

import { ListingCard } from "@/components/listing-card";
import { ListingGrid } from "@/components/listing-grid";
import {
  DashboardEmptyState,
  DashboardLinkButton,
  DashboardMessage,
  DashboardPage,
} from "@/components/dashboard-page";
import { listingCardProps, type PublicListing } from "@/lib/listing-card-data";
import { DISCOVERY_PATH } from "@/app/(public)/_components/discovery-path";

export default function SavedHomesPage() {
  const params = useParams<{ user: string }>();
  const userId = params.user;
  const { data: identity } = useMe();
  const role: string | undefined = identity?.role;
  const { toggle } = useSavedListings();

  const { data, isLoading, isError } = useApiList("listings/saved");

  // Saving is a renter feature (the backend 403s it for everyone else).
  if (role !== undefined && role !== "renter") {
    return (
      <DashboardEmptyState
        title="Saved Homes is for renters"
        description={
          role === "landlord"
            ? "Your own homes are under My Listings."
            : "Browse homes from the discovery page."
        }
        action={
          <DashboardLinkButton
            href={role === "landlord" ? `/dashboard/${userId}/listings` : DISCOVERY_PATH}
          >
            {role === "landlord" ? "Go to My Listings" : "Discover New Homes"}
          </DashboardLinkButton>
        }
      />
    );
  }

  if (isLoading) {
    return <DashboardMessage loading>Loading your saved homes…</DashboardMessage>;
  }

  if (isError) {
    return (
      <DashboardMessage tone="error">
        Couldn&apos;t load your saved homes. Refresh to try again.
      </DashboardMessage>
    );
  }

  const saved: any[] = data?.data ?? [];

  if (saved.length === 0) {
    return (
      <DashboardEmptyState
        title="You have no saved homes!"
        description="Add new homes from the discovery page"
        action={<DashboardLinkButton href={DISCOVERY_PATH}>Discover New Homes</DashboardLinkButton>}
      />
    );
  }

  return (
    <DashboardPage title="Saved Homes">
      <ListingGrid className="gap-x-6 gap-y-[30px]">
        {saved.map((row: any) => {
          // An optimistic row (just saved elsewhere, refetch pending) has
          // no listing_detail yet — skip it for the moment.
          const listing: PublicListing | undefined = row.listing_detail;
          if (!listing) return null;
          const listingId = listing.id ?? row.listing;
          return (
            <ListingCard
              key={row.id}
              {...listingCardProps(listing)}
              state="saved"
              // Public detail page, by SEO slug when there is one.
              href={`${DISCOVERY_PATH}/${listing.slug ?? listingId}`}
              onToggleFavorite={() => toggle(listingId)}
            />
          );
        })}
      </ListingGrid>
    </DashboardPage>
  );
}
