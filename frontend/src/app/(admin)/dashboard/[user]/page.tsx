"use client";
// Dashboard home — where every user lands after sign-in (useLogin
// redirects to "/dashboard", which resolves here).
//
// Figma "Accounts - Dashboard" (181:23170), read 2026-09-28, draws the
// renter's version in the 762px column:
//   "Akwaaba Me Nua!"      Clash Display Medium 32, -2%, black 80%, centred
//   "Looking for a home?"  Plus Jakarta Sans Medium 15, 8px below
//   search field           762x43, white, 6px corners, soft two-layer
//                          drop shadow, Inter 13 placeholder; 19px below
//   "Saved Homes" row      81px below: title + "View All Saved Homes >",
//                          then three Saved cards
//
// Landlords and staff get the same greeting and the same section row,
// holding their own three most relevant cards (My Property / Review
// Queue) — no Figma frame, same language. The search field is the
// renter's: it sends them to the Discovery Hub with `city` set, exactly
// like the Discovery search pill's Where field (the hub falls back to all
// homes and flies the map there when the city filter matches nothing).

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { useApiList } from "@/hooks/use-api";
import { useMe } from "@/hooks/use-auth";
import { useSavedListings } from "@/hooks/use-saved-listings";
import { ListingCard } from "@/components/listing-card";
import { ListingGrid } from "@/components/listing-grid";
import { PlaceAutocompleteInput } from "@/components/maps/place-autocomplete-input";
import {
  DashboardLinkButton,
  DashboardMessage,
  DashboardSection,
} from "@/components/dashboard-page";
import { listingCardProps, type PublicListing } from "@/lib/listing-card-data";
import {
  STATUS_BADGE_STATE,
  STATUS_META,
  parseStatus,
} from "@/lib/listing-status";
import { DISCOVERY_PATH } from "@/app/(public)/_components/discovery-path";

// How many cards a home-page section previews: one row of the grid.
const PREVIEW = 3;

export default function DashboardHomePage() {
  const { data: identity, isLoading } = useMe();
  const role: string | undefined = identity?.role;

  if (isLoading || !identity) {
    return <DashboardMessage loading>Loading your dashboard…</DashboardMessage>;
  }

  const subtitle =
    role === "renter"
      ? "Looking for a home?"
      : role === "landlord"
        ? "Here's how your homes are doing"
        : "Here's what's waiting for review";

  return (
    // Centred in the panel, as the frame's content block is.
    <div className="flex flex-1 flex-col justify-center px-4 py-12 md:px-8 md:py-16">
      <div className="mx-auto flex w-full max-w-[762px] flex-col gap-14 md:gap-20">
        <div className="flex flex-col items-center gap-[19px]">
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="font-display text-[32px] leading-[39px] font-medium tracking-[-0.02em] text-black/80">
              Akwaaba Me Nua!
            </h1>
            <p className="font-label text-[15px] leading-[19px] font-medium tracking-[-0.02em] text-black/80">
              {subtitle}
            </p>
          </div>
          {role === "renter" && <HomeSearch />}
        </div>

        {role === "renter" && <SavedPreview />}
        {role === "landlord" && <PropertyPreview />}
        {(role === "staff" || role === "admin") && <ReviewPreview />}
      </div>
    </div>
  );
}

function HomeSearch() {
  const router = useRouter();
  const [where, setWhere] = useState("");

  function go(value: string) {
    const city = value.trim();
    router.push(city ? `${DISCOVERY_PATH}?city=${encodeURIComponent(city)}` : DISCOVERY_PATH);
  }

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        go(where);
      }}
      // 43px tall; the two-layer shadow is the frame's (0 4 4 -4 and
      // 0 16 16 -8, #0c0c0d at 5% and 10%).
      className="flex h-[43px] w-full items-center rounded-md bg-white px-3 shadow-[0_4px_4px_-4px_rgb(12_12_13/0.05),0_16px_16px_-8px_rgb(12_12_13/0.1)] focus-within:ring-2 focus-within:ring-ring/40"
    >
      <label htmlFor="dashboard-home-search" className="sr-only">
        Where do you want to live?
      </label>
      <PlaceAutocompleteInput
        appearance="bare"
        id="dashboard-home-search"
        value={where}
        onChange={setWhere}
        onPlaceSelect={(place) => {
          if (place.formattedAddress) go(place.formattedAddress);
        }}
        placeholder="Look for your next home"
        className="w-full"
        inputClassName="text-foreground placeholder:text-muted-foreground h-5 py-0 text-base leading-5 sm:text-[13px]"
      />
    </form>
  );
}

function SavedPreview() {
  const params = useParams<{ user: string }>();
  const { toggle } = useSavedListings();
  const { data, isLoading } = useApiList("listings/saved");
  const saved: any[] = (data?.data ?? []).filter((row: any) => row.listing_detail);

  return (
    <DashboardSection
      title="Saved Homes"
      viewAllHref={saved.length > 0 ? `/dashboard/${params.user}/saved` : undefined}
      viewAllLabel="View All Saved Homes"
    >
      {isLoading ? (
        <DashboardMessage loading>Loading your saved homes…</DashboardMessage>
      ) : saved.length === 0 ? (
        <EmptyLine
          text="Tap the heart on any home to keep it here."
          href={DISCOVERY_PATH}
          label="Discover New Homes"
        />
      ) : (
        <ListingGrid className="gap-x-6 gap-y-[30px]">
          {saved.slice(0, PREVIEW).map((row: any) => {
            const listing: PublicListing = row.listing_detail;
            const listingId = listing.id ?? row.listing;
            return (
              <ListingCard
                key={row.id}
                {...listingCardProps(listing)}
                state="saved"
                href={`${DISCOVERY_PATH}/${listing.slug ?? listingId}`}
                onToggleFavorite={() => toggle(listingId)}
              />
            );
          })}
        </ListingGrid>
      )}
    </DashboardSection>
  );
}

function PropertyPreview() {
  const params = useParams<{ user: string }>();
  const base = `/dashboard/${params.user}/listings`;
  // Same ?mine=true scope as the My Property page.
  const { data, isLoading } = useApiList("listings", {
    filters: [{ field: "mine", value: "true" }],
  });
  const listings: any[] = data?.data ?? [];

  return (
    <DashboardSection
      title="My Property"
      viewAllHref={listings.length > 0 ? base : undefined}
      viewAllLabel="View All Properties"
    >
      {isLoading ? (
        <DashboardMessage loading>Loading your properties…</DashboardMessage>
      ) : listings.length === 0 ? (
        <EmptyLine
          text="List your first home — paddy staff verify it before it goes live."
          href={`${base}/create`}
          label="Add a new property"
        />
      ) : (
        <ListingGrid className="gap-x-6 gap-y-[30px]">
          {listings.slice(0, PREVIEW).map((listing: any) => {
            const status = parseStatus(listing.status);
            return (
              <ListingCard
                key={listing.id}
                {...listingCardProps(listing)}
                state="property"
                href={`${base}/${listing.id}`}
                status={
                  status
                    ? { label: STATUS_META[status].label, state: STATUS_BADGE_STATE[status] }
                    : undefined
                }
                action={null}
              />
            );
          })}
        </ListingGrid>
      )}
    </DashboardSection>
  );
}

function ReviewPreview() {
  const params = useParams<{ user: string }>();
  const queue = `/dashboard/${params.user}/reviews`;
  // Staff/admins see every status on GET /listings/; the queue is the
  // pending_review subset (same filter as the Review Queue page).
  const { data, isLoading } = useApiList("listings");
  const pending: any[] = (data?.data ?? []).filter(
    (listing: any) => parseStatus(listing.status) === "pending_review",
  );

  return (
    <DashboardSection
      title="Review Queue"
      viewAllHref={pending.length > 0 ? queue : undefined}
      viewAllLabel={`Review all ${pending.length}`}
    >
      {isLoading ? (
        <DashboardMessage loading>Loading the queue…</DashboardMessage>
      ) : pending.length === 0 ? (
        <EmptyLine text="The queue is clear — new submissions appear here automatically." />
      ) : (
        <ListingGrid className="gap-x-6 gap-y-[30px]">
          {pending.slice(0, PREVIEW).map((listing: any) => (
            <ListingCard
              key={listing.id}
              {...listingCardProps(listing)}
              // Opens the queue, where Approve / Reject live.
              href={queue}
            />
          ))}
        </ListingGrid>
      )}
    </DashboardSection>
  );
}

// A section with nothing in it yet: one line and, when there's an obvious
// next step, a button.
function EmptyLine({ text, href, label }: { text: string; href?: string; label?: string }) {
  return (
    <div className="border-hairline flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-5 py-6">
      <p className="font-label text-sm leading-5 font-medium tracking-[-0.02em] text-black/70">
        {text}
      </p>
      {href && label && (
        <DashboardLinkButton href={href} variant="secondary">
          {label}
        </DashboardLinkButton>
      )}
    </div>
  );
}
