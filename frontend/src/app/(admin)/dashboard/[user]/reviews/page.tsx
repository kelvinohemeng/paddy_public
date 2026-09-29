"use client";
// Staff/admin review console (backend PR #18) — the pending-verification
// queue behind paddy's "every listing is staff-verified" promise.
//
// There's no Figma frame for staff; this follows the Accounts frames'
// language (Figma 181:22493): the page title, the shared Listing Card
// grid, paddy badges and buttons.
//
// Data: GET /listings/ with NO ?mine filter. Staff and admins see ALL
// listings (any status); the queue is the client-side filter
// status === 'pending_review'. There's no ?status backend param, so no
// frontend hack pretends there is — if the queue grows large, the fix is
// a backend ?status param, requested then, not now.
//
// Each card: the listing (cover, title, price, details, landlord row),
// then Approve & publish (→ published) / Reject (→ rejected) via
// use-review-listing.ts. A decided card drops out on the refetch (its
// status no longer matches the filter) — that disappearance is the
// confirmation, with a Published / Rejected badge in the meantime.

import { useApiList } from "@/hooks/use-api";
import { useMe } from "@/hooks/use-auth";
import { useParams } from "next/navigation";
import { Check, X } from "lucide-react";

import { ListingCard } from "@/components/listing-card";
import { ListingGrid } from "@/components/listing-grid";
import { PaddyBadge } from "@/components/paddy-badge";
import { PaddyButton } from "@/components/paddy-button";
import {
  DashboardEmptyState,
  DashboardLinkButton,
  DashboardMessage,
  DashboardPage,
} from "@/components/dashboard-page";
import { listingCardProps } from "@/lib/listing-card-data";
import { parseStatus } from "@/lib/listing-status";
import { DISCOVERY_PATH } from "@/app/(public)/_components/discovery-path";
import {
  useReviewListing,
  type ReviewDecision,
} from "@/hooks/use-review-listing";

// One card owns its own review hook — submitting states and errors stay
// per card (approving card 3 must never disable card 5's buttons or show
// card 5 an error from card 3's request).
function ReviewCard({ listing }: { listing: any }) {
  const { review, isSubmitting, error, decidedAs } = useReviewListing(listing.id);

  function decide(decision: ReviewDecision) {
    review(decision);
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Default state: landlord row, no heart (no onToggleFavorite), no
          action row — the review controls sit underneath instead. Links to
          the public detail page, which staff can read for any status. */}
      <ListingCard
        {...listingCardProps(listing)}
        href={`${DISCOVERY_PATH}/${listing.slug ?? listing.id}`}
      />

      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}

      {decidedAs ? (
        <PaddyBadge
          state={decidedAs === "published" ? "success" : "error"}
          leftIcon={decidedAs === "published" ? Check : X}
          className="h-7"
        >
          {decidedAs === "published" ? "Published" : "Rejected"}
        </PaddyBadge>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {/* One submitting flag covers both decisions, so both buttons
              simply disable while a request is in flight. */}
          <PaddyButton
            size="sm"
            leftIcon={Check}
            disabled={isSubmitting}
            onClick={() => decide("published")}
          >
            Approve &amp; publish
          </PaddyButton>
          <PaddyButton
            variant="secondary"
            size="sm"
            leftIcon={X}
            disabled={isSubmitting}
            onClick={() => decide("rejected")}
          >
            Reject
          </PaddyButton>
        </div>
      )}
    </div>
  );
}

export default function ReviewsPage() {
  const params = useParams<{ user: string }>();
  const userId = params.user;
  const { data: identity } = useMe();
  const role: string | undefined = identity?.role;

  // GET /listings/ with deliberately NO ?mine filter — the queue needs
  // every landlord's pending rows. The backend role-scopes this: staff /
  // admin get all statuses, everyone else published-only (which the
  // filter below then empties).
  const { data, isLoading, isError } = useApiList("listings");

  // Non-reviewers get a pointer, not the queue. (The backend 403s any
  // review POST anyway — this gate is UX, not security.)
  if (role !== undefined && !["staff", "admin"].includes(role)) {
    return (
      <DashboardEmptyState
        title="The review queue is for paddy staff"
        description={
          role === "landlord"
            ? "Your submissions and their status are under My Listings."
            : "Your tenancies live under Active Lease."
        }
        action={
          <DashboardLinkButton
            href={
              role === "landlord"
                ? `/dashboard/${userId}/listings`
                : `/dashboard/${userId}/leases`
            }
          >
            {role === "landlord" ? "Go to My Listings" : "Go to Active Lease"}
          </DashboardLinkButton>
        }
      />
    );
  }

  if (isLoading) {
    return <DashboardMessage loading>Loading the review queue…</DashboardMessage>;
  }

  if (isError) {
    return (
      <DashboardMessage tone="error">
        Couldn&apos;t load the review queue. Refresh to try again.
      </DashboardMessage>
    );
  }

  const all: any[] = data?.data ?? [];
  // parseStatus keeps this to real lifecycle values — an unexpected
  // status string never silently enters the queue.
  const pending = all.filter(
    (listing: any) => parseStatus(listing.status) === "pending_review",
  );

  if (pending.length === 0) {
    return (
      <DashboardEmptyState
        title="The queue is clear"
        description="Every submitted listing has been reviewed. New submissions appear here automatically"
      />
    );
  }

  return (
    <DashboardPage
      title="Review Queue"
      action={<PaddyBadge state="warning">{pending.length} pending</PaddyBadge>}
    >
      <ListingGrid className="gap-x-6 gap-y-[30px]">
        {pending.map((listing: any) => (
          <ReviewCard key={listing.id} listing={listing} />
        ))}
      </ListingGrid>
    </DashboardPage>
  );
}
