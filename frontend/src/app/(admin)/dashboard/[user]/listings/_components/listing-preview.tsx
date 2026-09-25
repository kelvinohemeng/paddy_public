"use client";

import { useApiInvalidate, useApiList, useApiOne } from "@/hooks/use-api";
import { apiPost } from "@/lib/api-client";
import { errorMessage } from "@/lib/api";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { MapPin, Bed, Bath, BadgeCheck, ExternalLink, Archive, ArchiveRestore } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  STATUS_META,
  OWNER_ACTIONABLE,
  parseStatus,
  type ListingStatus,
} from "@/lib/listing-status";
import { useSubmitForReview } from "@/hooks/use-submit-for-review";
import { Loader2, SendHorizontal } from "lucide-react";

// ── FEATURE FLAG: listing lifecycle (status + submit-for-review) ──
// LIVE as of backend PR #16 (feature/listing-queryset-status-photos
// merged): ListingSerializer now includes `status` (read-only), and
// POST /listings/<id>/submit-for-review/ exists with the exact contract
// use-submit-for-review.ts was built against. Keeping the constant (not
// inlining `true`) preserves the single kill-switch if the backend ever
// needs to be rolled back independently of the frontend.
const LIFECYCLE_UI_ENABLED = true;

// Shared preview body for a single listing — rendered by BOTH:
//   1. @modal/(.)dashboard/[user]/listings/[id]/page.tsx — docked panel
//   2. dashboard/[user]/listings/[id]/page.tsx           — full-page fallback
// Same "one component, two chrome wrappers" pattern as
// ListingCreateForm/listing-create-form.tsx, for the same reason: the
// actual preview markup/data-fetching logic must never exist twice.

type ListingPreviewProps = {
  listingId: string | number;
  // Optional — lets the docked panel close/navigate itself without this
  // component needing to know which chrome it's rendered inside.
  onEdit?: () => void;
};

// Backend's ListingPhotoSerializer returns `image` as the photo URL
// field (fields = ['id', 'image', 'order', 'is_cover']) — the other
// two keys here are defensive fallbacks only, in case that shape
// ever changes.
function getPhotoUrl(photo: any): string | null {
  return photo?.image ?? photo?.image_url ?? photo?.url ?? null;
}

export function ListingPreview({ listingId, onEdit }: ListingPreviewProps) {
  const params = useParams<{ user: string }>();
  const userId = params.user;

  const { data: listing, isLoading, isError } = useApiOne(
    "listings",
    listingId,
  );

  // Landlords ARCHIVE instead of deleting (Kelvin's 2026-09 decision):
  // DELETE /listings/<id>/ is admin-only on the backend, because deleting
  // a listing would also erase renters' paid unlock records and leases.
  // Archiving takes it off Discovery and keeps that history; Restore puts
  // it back as a draft that must be re-submitted for staff review.
  const invalidate = useApiInvalidate();
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

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
      // No navigation: the refetch shows the new status badge and swaps
      // Archive/Restore in place. Archived listings stay in the owner's
      // own list (they're only hidden from the public).
    } catch (err) {
      toast.error(errorMessage(err, "Could not update this listing"));
    } finally {
      setStatusBusy(false);
      setConfirmingArchive(false);
    }
  }

  // Amenities come back from the current backend serializer in TWO
  // shapes: `amenities` (a flat list of PKs — what create/update sends)
  // and `amenities_detail` (full {id,name,slug} objects, read-only, from
  // the expanded serializer). Prefer amenities_detail — it renders the
  // names with zero extra round trips. The id-resolving path below is
  // kept purely as a fallback for a serializer that doesn't embed it.
  const amenitiesDetail: any[] = Array.isArray(listing?.amenities_detail)
    ? listing.amenities_detail
    : [];

  // Only resolve names via GET /core/amenities/ when the response
  // didn't already include amenities_detail. Skipped via `enabled`
  // when there's nothing to resolve; hooks rules are rules.
  const amenityIds: number[] =
    amenitiesDetail.length > 0
      ? []
      : Array.isArray(listing?.amenities)
        ? listing.amenities.map((a: any) => (typeof a === "object" ? a.id : a))
        : [];

  const { data: amenitiesResult } = useApiList("core/amenities", {
    enabled: amenityIds.length > 0,
  });

  const amenityNames: string[] =
    amenitiesDetail.length > 0
      ? amenitiesDetail
          .filter((a: any) => typeof a === "object")
          .map((a: any) => a.name)
      : (amenitiesResult?.data ?? [])
          .filter((a: any) => amenityIds.includes(a.id))
          .map((a: any) => a.name);

  const photos: any[] = Array.isArray(listing?.photos) ? listing.photos : [];
  const coverUrl = photos.length > 0 ? getPhotoUrl(photos[0]) : null;

  // Same rent/buy price split the backend's Listing.clean() enforces —
  // exactly ONE price field is meaningful per listing_type.
  const isBuy = listing?.listing_type === "buy";
  const price = isBuy ? listing?.price_one_time : listing?.price_monthly;
  const advanceLabel =
    listing?.advance_rent_period === "6_months"
      ? "6 months advance"
      : listing?.advance_rent_period === "1_year"
        ? "1 year advance"
        : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
      </div>
    );
  }

  if (isError || !listing) {
    return (
      <p className="text-red-500 p-4 text-sm">
        Couldn&apos;t load this listing.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-muted aspect-video w-full overflow-hidden rounded-md border">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverUrl}
            alt={listing.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            No photos yet
          </div>
        )}
      </div>

      {photos.length > 1 && (
        <div className="grid grid-cols-4 gap-2">
          {photos.slice(1, 5).map((photo, i) => {
            const url = getPhotoUrl(photo);
            if (!url) return null;
            return (
              <div
                key={i}
                className="bg-muted aspect-square overflow-hidden rounded-md border"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`${listing.title} photo ${i + 2}`}
                  className="h-full w-full object-cover"
                />
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-semibold leading-tight">
            {listing.title}
          </h2>
          <div className="flex shrink-0 items-center gap-1.5">
            {listing.is_staff_verified && (
              <Badge className="gap-1">
                <BadgeCheck className="size-3.5" />
                Staff Verified
              </Badge>
            )}
            {LIFECYCLE_UI_ENABLED && <StatusBadge status={parseStatus(listing.status)} />}
            {/* Was: a bare {listing.status && <Badge>{listing.status}</Badge>} —
                dead code, since the serializer excludes status and the key
                never arrives in any response. Replaced by the flag-gated
                StatusBadge above; see the LIFECYCLE_UI_ENABLED comment. */}
          </div>
        </div>

        <p className="text-muted-foreground flex items-center gap-1 text-sm">
          <MapPin className="size-3.5 shrink-0" />
          {listing.address_precise || `${listing.neighborhood ?? ""} ${listing.city ?? ""}`.trim() || "No address yet"}
        </p>

        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="flex items-center gap-1">
            <Bed className="size-3.5" /> {listing.bedrooms} bd
          </span>
          <span className="flex items-center gap-1">
            <Bath className="size-3.5" /> {listing.bathrooms} ba
          </span>
          {price && (
            <span className="text-foreground font-medium">
              GHS {price}
              {isBuy ? "" : "/mo"}
            </span>
          )}
          {advanceLabel && <Badge variant="secondary">{advanceLabel}</Badge>}
        </div>
      </div>

      {listing.description && (
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {listing.description}
        </p>
      )}

      {amenityNames.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {amenityNames.map((name: string) => (
            <Badge key={name} variant="secondary">
              {name}
            </Badge>
          ))}
        </div>
      )}

      {(listing.landlord_public?.full_name || listing.virtual_tour_url) && (
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
          {listing.landlord_public?.full_name && (
            <span>
              Hosted by <span className="font-medium">{listing.landlord_public.full_name}</span>
              {listing.landlord_public.id_verified && " · ID verified"}
            </span>
          )}
          {listing.virtual_tour_url && (
            <a
              href={listing.virtual_tour_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-medium text-indigo-600 hover:underline"
            >
              <ExternalLink className="size-3.5" />
              360° Virtual Tour
            </a>
          )}
        </div>
      )}

      {/* Lifecycle CTA — renders only when the flag is on AND the status
          is one a landlord may transition (draft / rejected → pending_review).
          LIVE against backend PR #16: POST
          /listings/<id>/submit-for-review/ (see use-submit-for-review.ts).
          This preview renders owner rows (dashboard ?mine=true scope), so
          the CTA shows exactly where the handoff requires it. */}
      {LIFECYCLE_UI_ENABLED && (
        <SubmitForReviewSection
          listingId={listingId}
          status={parseStatus(listing.status)}
        />
      )}

      <div className="flex gap-2 border-t pt-4">
        {onEdit ? (
          <Button type="button" onClick={onEdit} className="flex-1">
            Update Listing
          </Button>
        ) : (
          <Link href={`/dashboard/${userId}/listings/${listingId}/edit`} className="flex-1">
            <Button type="button" className="w-full">
              Update Listing
            </Button>
          </Link>
        )}
        {listing.status === "archived" ? (
          <Button
            type="button"
            variant="outline"
            disabled={statusBusy}
            onClick={() => changeLifecycle("restore")}
          >
            <ArchiveRestore className="size-4" />
            {statusBusy ? "Restoring…" : "Restore"}
          </Button>
        ) : listing.status !== "leased" ? (
          // No archive while leased: the backend refuses it (someone
          // lives there under an active lease — end the lease first).
          <Button
            type="button"
            variant={confirmingArchive ? "destructive" : "outline"}
            disabled={statusBusy}
            onClick={() => changeLifecycle("archive")}
          >
            <Archive className="size-4" />
            {statusBusy ? "Archiving…" : confirmingArchive ? "Confirm archive" : "Archive"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ── Lifecycle pieces (shared by panel + full page via ListingPreview) ──

function StatusBadge({ status }: { status: ListingStatus | null }) {
  // null = status missing from the response (flag should have prevented
  // reaching here) — render nothing rather than a wrong badge.
  if (!status) return null;

  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge variant={meta.badgeVariant} className="gap-1">
      <Icon className="size-3.5" />
      {meta.label}
    </Badge>
  );
}

function SubmitForReviewSection({
  listingId,
  status,
}: {
  listingId: string | number;
  status: ListingStatus | null;
}) {
  const { submit, isSubmitting, error } = useSubmitForReview(listingId);

  // Only draft/rejected listings can be submitted (mirrors the backend's
  // allowed transition set — the server re-checks regardless).
  if (!status || !OWNER_ACTIONABLE.has(status)) return null;

  const isResubmit = status === "rejected";

  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      <p className="text-muted-foreground text-xs">
        {isResubmit
          ? "This listing was rejected during staff review — fix the issues, then resubmit it for another review."
          : "This listing is a draft. Submit it for staff review — once verified, it goes live on the marketplace."}
      </p>
      {error && <p className="text-destructive text-xs">{error}</p>}
      <Button
        type="button"
        size="sm"
        className="w-full"
        onClick={submit}
        disabled={isSubmitting}
      >
        {isSubmitting && <Loader2 className="size-3.5 animate-spin" />}
        <SendHorizontal className="size-3.5" />
        {isResubmit ? "Resubmit for review" : "Submit for review"}
      </Button>
    </div>
  );
}
