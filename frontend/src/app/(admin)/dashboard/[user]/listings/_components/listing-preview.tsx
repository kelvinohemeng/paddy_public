"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Loader2, PencilLine, SendHorizontal } from "lucide-react";

import { useApiInvalidate, useApiOne } from "@/hooks/use-api";
import { useSubmitForReview } from "@/hooks/use-submit-for-review";
import { apiPost } from "@/lib/api-client";
import { errorMessage } from "@/lib/api";
import {
  OWNER_ACTIONABLE,
  parseStatus,
  type ListingStatus,
} from "@/lib/listing-status";
import { PaddyButton } from "@/components/paddy-button";
import { ListingDetail } from "@/app/(public)/homes/[id]/_components/listing-detail";

// The landlord's preview of their own listing — rendered by BOTH:
//   1. @modal/(.)dashboard/[user]/listings/[id]/page.tsx — the drawer
//   2. dashboard/[user]/listings/[id]/page.tsx           — full-page fallback
//
// The body is the Discovery Hub's own ListingDetail (ownerView), so a
// landlord sees exactly what renters will, minus renter-only actions.
// The owner's actions live in ListingOwnerActions below, which each
// wrapper places in its header — the drawer puts them at the right end
// of the close/expand row. Both components read the listing through
// useApiOne with the same key, so TanStack Query fetches it once.

export function ListingPreview({ listingId }: { listingId: string | number }) {
  const { data: listing, isLoading, isError } = useApiOne("listings", listingId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-black/40" />
      </div>
    );
  }

  if (isError || !listing) {
    return (
      <p className="text-destructive p-8 text-center text-sm">
        Couldn&apos;t load this listing.
      </p>
    );
  }

  return <ListingDetail listing={listing} isAuthenticated ownerView />;
}

// One line under the drawer title telling the landlord where the listing
// stands and what (if anything) they need to do next.
export function listingStatusHint(status: ListingStatus | null): string | undefined {
  switch (status) {
    case "draft":
      return "Draft — submit it for review to go live.";
    case "pending_review":
      return "In review — paddy staff are verifying it.";
    case "published":
      return "Live on the Discovery Hub.";
    case "rejected":
      return "Rejected — fix the issues, then resubmit.";
    case "archived":
      return "Archived — hidden from renters. Restore to edit and resubmit.";
    case "leased":
      return "Leased — off the market.";
    default:
      return undefined;
  }
}

// Hook form of the listing's status, for the wrappers' titles/hints.
export function useListingStatus(listingId: string | number): ListingStatus | null {
  const { data } = useApiOne("listings", listingId);
  return parseStatus(data?.status);
}

export function ListingOwnerActions({
  listingId,
  onEdit,
}: {
  listingId: string | number;
  // Drawer: flips the same drawer into the edit form. Omitted (full
  // page): links to the .../edit route instead.
  onEdit?: () => void;
}) {
  const params = useParams<{ user: string }>();
  const router = useRouter();
  const { data: listing } = useApiOne("listings", listingId);
  const status = parseStatus(listing?.status);

  // Landlords ARCHIVE instead of deleting (Kelvin's 2026-09 decision):
  // DELETE /listings/<id>/ is admin-only on the backend, because deleting
  // a listing would also erase renters' paid unlock records and leases.
  // Archiving takes it off Discovery and keeps that history; Restore puts
  // it back as a draft that must be re-submitted for staff review.
  const invalidate = useApiInvalidate();
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const { submit, isSubmitting, error: submitError } = useSubmitForReview(listingId);

  // Surface submit failures as a toast — there's no room for an inline
  // error line in the header row. (An effect, not render: a toast is a
  // side effect and must not fire twice under Strict Mode re-renders.)
  useEffect(() => {
    if (submitError) toast.error(submitError);
  }, [submitError]);

  async function changeLifecycle(action: "archive" | "restore") {
    if (action === "archive" && !confirmingArchive) {
      // Two-tap confirm — first tap arms, second tap fires.
      setConfirmingArchive(true);
      return;
    }
    setStatusBusy(true);
    try {
      await apiPost(`/listings/${listingId}/${action}/`);
      await invalidate("listings");
      toast.success(action === "archive" ? "Listing archived" : "Listing restored as a draft");
    } catch (err) {
      toast.error(errorMessage(err, "Could not update this listing"));
    } finally {
      setStatusBusy(false);
      setConfirmingArchive(false);
    }
  }

  if (!listing) return null;

  // Labels hide on phones (icon-only) so the header row still fits.
  const label = (text: string) => <span className="max-sm:sr-only">{text}</span>;

  return (
    <>
      {status && OWNER_ACTIONABLE.has(status) && (
        <PaddyButton
          size="sm"
          variant="secondary"
          leftIcon={SendHorizontal}
          isLoading={isSubmitting}
          onClick={submit}
          title={status === "rejected" ? "Resubmit for review" : "Submit for review"}
        >
          {label(status === "rejected" ? "Resubmit" : "Submit for review")}
        </PaddyButton>
      )}

      {status === "archived" ? (
        <PaddyButton
          size="sm"
          variant="secondary"
          leftIcon={ArchiveRestore}
          isLoading={statusBusy}
          onClick={() => changeLifecycle("restore")}
          title="Restore as a draft"
        >
          {label("Restore")}
        </PaddyButton>
      ) : status !== "leased" ? (
        <PaddyButton
          size="sm"
          variant={confirmingArchive ? "danger" : "secondary"}
          leftIcon={Archive}
          isLoading={statusBusy}
          onClick={() => changeLifecycle("archive")}
          onBlur={() => setConfirmingArchive(false)}
          title={confirmingArchive ? "Click again to archive" : "Archive"}
        >
          {label(confirmingArchive ? "Confirm archive" : "Archive")}
        </PaddyButton>
      ) : null}

      <PaddyButton
        size="sm"
        leftIcon={PencilLine}
        onClick={() =>
          onEdit
            ? onEdit()
            : router.push(`/dashboard/${params.user}/listings/${listingId}/edit`)
        }
        title="Update listing"
      >
        {label("Update listing")}
      </PaddyButton>
    </>
  );
}
