"use client";

import { useParams } from "next/navigation";

import { useApiList } from "@/hooks/use-api";
import { useMe } from "@/hooks/use-auth";
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
import { STATUS_BADGE_STATE, STATUS_META, parseStatus } from "@/lib/listing-status";

// "Homes I added": the listings a staff member or admin created for
// landlords (Phase 2, field sales). GET /listings/?created_by=me, newest
// first (contract C4). Same card as My Listings, with the landlord's name
// and their listing status, plus "Invite pending" while the landlord
// hasn't set a password yet (landlord_has_claimed, staff-only, false).

export default function HomesAddedPage() {
  const params = useParams<{ user: string }>();
  const userId = params.user;
  const { data: identity } = useMe();
  const role: string | undefined = identity?.role;
  const isStaff = role === "staff" || role === "admin";

  const { data, isPending, isError } = useApiList("listings", {
    filters: [{ field: "created_by", value: "me" }],
    enabled: isStaff,
  });

  const addHref = `/dashboard/${userId}/listings/create`;

  // Navigation, not security: the nav only shows this to staff.
  if (role !== undefined && !isStaff) {
    return (
      <DashboardEmptyState
        title="This page is for paddy staff"
        description={
          role === "landlord"
            ? "Your homes are under My Listings."
            : "The homes you're keeping an eye on are under Saved Homes."
        }
        action={
          <DashboardLinkButton
            href={`/dashboard/${userId}/${role === "landlord" ? "listings" : "saved"}`}
          >
            {role === "landlord" ? "Go to My Listings" : "Go to Saved Homes"}
          </DashboardLinkButton>
        }
      />
    );
  }

  if (isPending) {
    return <DashboardMessage loading>Loading the homes you added…</DashboardMessage>;
  }

  if (isError) {
    return (
      <DashboardMessage tone="error">
        Couldn&apos;t load the homes you added. Refresh to try again.
      </DashboardMessage>
    );
  }

  const listings: any[] = data?.data ?? [];

  if (listings.length === 0) {
    return (
      <DashboardEmptyState
        title="No homes added yet"
        description="Homes you list for landlords show up here."
        action={<DashboardLinkButton href={addHref}>Add a home</DashboardLinkButton>}
      />
    );
  }

  return (
    <DashboardPage
      title="Homes I added"
      action={<DashboardLinkButton href={addHref}>Add a home</DashboardLinkButton>}
    >
      <ListingGrid className="gap-x-6 gap-y-[30px]">
        {listings.map((listing: any) => {
          const status = parseStatus(listing.status);
          return (
            <div key={listing.id} className="flex flex-col gap-2">
              {/* Opens the listing's preview drawer, where staff can update
                  it or add the photos that didn't upload. */}
              <ListingCard
                {...listingCardProps(listing)}
                state="property"
                href={`/dashboard/${userId}/listings/${listing.id}`}
                status={
                  status
                    ? { label: STATUS_META[status].label, state: STATUS_BADGE_STATE[status] }
                    : undefined
                }
                action={null}
              />
              {listing.landlord_has_claimed === false && (
                <PaddyBadge state="warning" className="h-7 w-fit">
                  Invite pending
                </PaddyBadge>
              )}
            </div>
          );
        })}
      </ListingGrid>
    </DashboardPage>
  );
}
