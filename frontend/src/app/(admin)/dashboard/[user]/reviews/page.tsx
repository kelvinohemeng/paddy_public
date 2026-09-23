"use client";
// Staff/admin review console (backend PR #18, merged to main) — the
// pending-verification queue behind paddy's "every listing is
// staff-verified" promise.
//
// Data: GET /listings/ with NO ?mine filter. Staff and admins see ALL
// listings (any status) per PR #18's queryset; the queue is the
// client-side filter status === 'pending_review'. Deliberate per the
// handoff: there is no ?status backend param, so no frontend hack
// pretends there is — if this queue grows large, the fix is a backend
// ?status param, requested then, not now.
//
// Each row: key facts + cover thumb + landlord snippet, Approve
// (→ published) / Reject (→ rejected) via use-review-listing.ts.
// Decided rows vanish on invalidate (their status no longer matches
// the queue filter) — the disappearance IS the confirmation, plus a
// transient decided label while the refetch lands.

import { useApiList } from "@/hooks/use-api";
import { useMe } from "@/hooks/use-auth";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Bed, Bath, MapPin, Check, X, Loader2, ShieldCheck } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { parseStatus } from "@/lib/listing-status";
import {
  useReviewListing,
  type ReviewDecision,
} from "@/hooks/use-review-listing";

function getPhotoUrl(photo: any): string | null {
  return photo?.image ?? photo?.image_url ?? photo?.url ?? null;
}

// One queue row owns its own review hook instance — submitting states
// and errors stay per-row (approving row 3 must never disable row 5's
// buttons or show row 5 an error from row 3's request).
function ReviewRow({
  listing,
  userId,
}: {
  listing: any;
  userId: string;
}) {
  const { review, isSubmitting, error, decidedAs } = useReviewListing(
    listing.id,
  );

  const photos: any[] = Array.isArray(listing.photos) ? listing.photos : [];
  const coverUrl = photos.length > 0 ? getPhotoUrl(photos[0]) : null;

  function decide(decision: ReviewDecision) {
    review(decision);
  }

  return (
    <Card>
      <CardContent className="flex gap-4 py-4">
        <div className="bg-muted aspect-video w-36 shrink-0 overflow-hidden rounded-md">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverUrl}
              alt={listing.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
              No photo
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <Link
              href={`/homes/${listing.id}`}
              className="truncate font-medium hover:underline"
            >
              {listing.title}
            </Link>
            {decidedAs && (
              <Badge
                variant={decidedAs === "published" ? "default" : "destructive"}
                className="shrink-0 gap-1"
              >
                {decidedAs === "published" ? (
                  <Check className="size-3" />
                ) : (
                  <X className="size-3" />
                )}
                {decidedAs === "published" ? "Published" : "Rejected"}
              </Badge>
            )}
          </div>

          <p className="text-muted-foreground flex items-center gap-1 truncate text-xs">
            <MapPin className="size-3 shrink-0" />
            {listing.neighborhood || listing.city || "No location yet"}
            {listing.landlord_public?.full_name &&
              ` · by ${listing.landlord_public.full_name}`}
            {listing.landlord_public?.id_verified && " · ID verified"}
          </p>

          <div className="text-muted-foreground flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1">
              <Bed className="size-3" /> {listing.bedrooms}
            </span>
            <span className="flex items-center gap-1">
              <Bath className="size-3" /> {listing.bathrooms}
            </span>
            {listing.price_monthly && (
              <span className="text-foreground font-medium">
                GHS {listing.price_monthly}/mo
              </span>
            )}
            {listing.advance_rent_period &&
              listing.advance_rent_period !== "none" && (
                <span>{listing.advance_rent_period.replace("_", " ")}</span>
              )}
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          {!decidedAs && (
            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                disabled={isSubmitting}
                onClick={() => decide("published")}
              >
                {isSubmitting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}
                Approve & publish
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => decide("rejected")}
              >
                <X className="size-3.5" />
                Reject
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ReviewsPage() {
  const params = useParams<{ user: string }>();
  const userId = params.user;
  const { data: identity } = useMe();
  const role: string | undefined = identity?.role;

  // GET /listings/ with deliberately NO ?mine filter — the review
  // console needs every landlord's pending rows, not just the
  // reviewer's own (staff/admins own no listings anyway). The backend
  // role-scopes this: staff/admin get all statuses, everyone else gets
  // published-only (which the client filter below then empties).
  const { data, isLoading, isError } = useApiList("listings");

  // Non-reviewers get a pointer, not the queue. (The backend would 403
  // any actual review POST anyway — this gate is UX, not security.)
  if (role !== undefined && !["staff", "admin"].includes(role)) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">
          Listing review is a staff workflow —{" "}
          {role === "landlord" ? (
            <>
              your submissions live under{" "}
              <Link
                href={`/dashboard/${userId}/listings`}
                className="text-indigo-600 underline"
              >
                Listings
              </Link>
              .
            </>
          ) : (
            <>
              your tenancies live under{" "}
              <Link
                href={`/dashboard/${userId}/leases`}
                className="text-indigo-600 underline"
              >
                Leases
              </Link>
              .
            </>
          )}
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <p>Loading review queue...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <p className="text-red-500">Failed to load the review queue.</p>
      </div>
    );
  }

  const all: any[] = data?.data ?? [];
  // The pending queue: client-side filter, exactly as the handoff
  // specifies (no ?status param exists server-side). parseStatus keeps
  // this to real lifecycle values — an unexpected status string never
  // silently enters the queue.
  const pending = all.filter(
    (listing: any) => parseStatus(listing.status) === "pending_review",
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">

      <div className="flex items-center gap-2">
        <ShieldCheck className="size-5" />
        <h1 className="text-2xl font-bold">Review queue</h1>
        <Badge variant="secondary">{pending.length} pending</Badge>
      </div>

      {pending.length === 0 ? (
        <p className="text-muted-foreground">
          Queue is clear — every submitted listing has been reviewed.
          New landlord submissions appear here automatically.
        </p>
      ) : (
        pending.map((listing: any) => (
          <ReviewRow key={listing.id} listing={listing} userId={userId} />
        ))
      )}
    </div>
  );
}
