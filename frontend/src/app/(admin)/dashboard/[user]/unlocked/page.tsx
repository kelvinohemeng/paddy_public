"use client";
// Unlocked Listings — every home this user has paid to unlock, with the
// precise address and the landlord's contact right on the page, so it's
// two clicks from the dashboard to a landlord's phone.
//
// Reads GET /payments/unlocks/ (the caller's own unlocks, newest first;
// see ListingUnlock in lib/payments.ts). Same query as the receipts on the
// Payment page, so visiting one warms the other.
//
// Unlocks stay listed after a home is archived, paused or rented (they
// paid for that contact). Those get a "No longer listed" badge and no
// link: the public page only serves published homes, so it would 404.
//
// Any role can unlock, so there's no role gate; only the renter nav links
// here for now.

import { MapPin } from "lucide-react";

import { useApiList } from "@/hooks/use-api";
import { ContactReveal } from "@/components/landlord-contact";
import { ListingCard } from "@/components/listing-card";
import { ListingGrid } from "@/components/listing-grid";
import { PaddyBadge } from "@/components/paddy-badge";
import {
  DashboardEmptyState,
  DashboardLinkButton,
  DashboardMessage,
  DashboardPage,
} from "@/components/dashboard-page";
import { listingCardProps } from "@/lib/listing-card-data";
import type { ListingUnlock } from "@/lib/payments";
import { DISCOVERY_PATH } from "@/app/(public)/_components/discovery-path";

export default function UnlockedListingsPage() {
  const { data, isLoading, isError } = useApiList<ListingUnlock>("payments/unlocks");

  if (isLoading) {
    return <DashboardMessage loading>Loading your unlocked homes…</DashboardMessage>;
  }

  if (isError) {
    return (
      <DashboardMessage tone="error">
        Couldn&apos;t load your unlocked homes. Refresh to try again.
      </DashboardMessage>
    );
  }

  const unlocks = data?.data ?? [];

  if (unlocks.length === 0) {
    return (
      <DashboardEmptyState
        title="You haven't unlocked any homes yet"
        description="Unlock a home on its listing page to see its address and the landlord's contact here."
        action={<DashboardLinkButton href={DISCOVERY_PATH}>Discover New Homes</DashboardLinkButton>}
      />
    );
  }

  return (
    <DashboardPage title="Unlocked Listings">
      <ListingGrid className="gap-x-6 gap-y-[30px]">
        {unlocks.map(({ id, listing_detail: listing }) => {
          const listed = listing.status === "published";
          const address = [listing.address_precise, listing.neighborhood, listing.city]
            .filter(Boolean)
            .join(", ");
          return (
            <div key={id} className="flex flex-col gap-2">
              <ListingCard
                {...listingCardProps(listing)}
                href={listed ? `${DISCOVERY_PATH}/${listing.slug ?? listing.id}` : undefined}
              />
              {!listed && (
                <PaddyBadge className="h-7 self-start">No longer listed</PaddyBadge>
              )}
              <p className="flex items-start gap-1.5 text-sm text-black/80">
                <MapPin className="mt-0.5 size-4 shrink-0" />
                {address}
              </p>
              <ContactReveal contact={listing.landlord_contact} />
            </div>
          );
        })}
      </ListingGrid>
    </DashboardPage>
  );
}
