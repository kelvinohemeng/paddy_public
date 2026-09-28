"use client";

import { useState } from "react";
import { useApiInvalidate } from "@/hooks/use-api";
import { authedFetch, errorMessage } from "@/lib/api";
import { errorCode } from "@/lib/api-client";

// Frontend half of the listing lifecycle — LIVE against backend PR #16
// (feature/listing-queryset-status-photos, merged to main). The endpoint
// contract, verified against ListingViewSet.submit_for_review on main:
//   POST /listings/<id>/submit-for-review/   (IsAuthenticated)
//   - Ownership checked INSIDE the action (403 for cross-owner, even on
//     listings the landlord queryset exposes via the published-UNION)
//   - 400 {'error': 'Only draft or rejected listings can be submitted
//     for review'} for any non draft/rejected current status
//   - 403 {'error', 'code': 'listing_limit_reached', listings_used,
//     listing_cap} when the plan's live slots are all in use (PR #34:
//     the live limit is checked HERE, not when a draft is created)
//   - Success: 200 with the FULL re-serialized listing
//     (self.get_serializer(listing).data — request context included, so
//     the owner's own address/contact stay gated-open in the response)
//
// The only landlord-driven status transition in the API: draft (or a
// fixed rejected listing) → pending_review. Publishing stays staff-only
// in Django admin — by design, per the brand's verification promise.
//
// Two ways to use it:
// - the preview's Submit button: useSubmitForReview(id), then submit()
//   and read `error` / `isSubmitting`;
// - the listing form stepper, which only learns the id once its POST
//   has created the listing: useSubmitForReview(), then
//   `await submit(newId)` and branch on the returned result.

type Phase = "idle" | "submitting" | "success" | "error";

export type SubmitForReviewResult =
  | { ok: true }
  | {
      ok: false;
      message: string;
      // Machine-readable reason from the backend, e.g.
      // "listing_limit_reached". Absent for network errors.
      code?: string;
      listingsUsed?: number;
      listingCap?: number;
    };

export function useSubmitForReview(listingId?: string | number) {
  const invalidate = useApiInvalidate();

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(idOverride?: string | number): Promise<SubmitForReviewResult> {
    const id = idOverride ?? listingId;
    if (id === undefined) {
      return { ok: false, message: "No listing to submit." };
    }
    if (phase === "submitting") {
      return { ok: false, message: "Already submitting." };
    }
    setPhase("submitting");
    setError(null);

    try {
      const res = await authedFetch(`/listings/${id}/submit-for-review/`, {
        method: "POST",
      });

      if (!res.ok) {
        // Backend contract: {'error': '...'} on every non-2xx — e.g. the
        // 400 above, if the listing's status changed in another tab
        // between this page rendering and the click landing.
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
          listings_used?: number;
          listing_cap?: number;
        };
        const message =
          body.error ??
          body.detail ??
          `Could not submit for review (HTTP ${res.status})`;
        setPhase("error");
        setError(message);
        return {
          ok: false,
          message,
          code: errorCode(body),
          listingsUsed: body.listings_used,
          listingCap: body.listing_cap,
        };
      }

      setPhase("success");
      // Raw POST, not a cache-aware mutation — invalidate manually so
      // the preview (detail query) and the grid (list query) re-run.
      // Both live under ["api", "listings"], one call refreshes both.
      // The subscription card's live-listing count changed too.
      invalidate(["listings", "payments"]);
      return { ok: true };
    } catch (err) {
      const message = errorMessage(err, "Could not submit for review");
      setPhase("error");
      setError(message);
      return { ok: false, message };
    }
  }

  return { submit, phase, error, isSubmitting: phase === "submitting" };
}
