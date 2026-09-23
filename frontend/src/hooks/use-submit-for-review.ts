"use client";

import { useState } from "react";
import { useApiInvalidate } from "@/hooks/use-api";
import { authedFetch, errorMessage } from "@/lib/api";

// Frontend half of the listing lifecycle — LIVE against backend PR #16
// (feature/listing-queryset-status-photos, merged to main). The endpoint
// contract, verified against ListingViewSet.submit_for_review on main:
//   POST /listings/<id>/submit-for-review/   (IsAuthenticated)
//   - Ownership checked INSIDE the action (403 for cross-owner, even on
//     listings the landlord queryset exposes via the published-UNION)
//   - 400 {'error': 'Only draft or rejected listings can be submitted
//     for review'} for any non draft/rejected current status
//   - Success: 200 with the FULL re-serialized listing
//     (self.get_serializer(listing).data — request context included, so
//     the owner's own address/contact stay gated-open in the response)
//
// The only landlord-driven status transition in the API: draft (or a
// fixed rejected listing) → pending_review. Publishing stays staff-only
// in Django admin — by design, per the brand's verification promise.

type Phase = "idle" | "submitting" | "success" | "error";

export function useSubmitForReview(listingId: string | number) {
  const invalidate = useApiInvalidate();

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (phase === "submitting") return;
    setPhase("submitting");
    setError(null);

    try {
      const res = await authedFetch(
        `/listings/${listingId}/submit-for-review/`,
        { method: "POST" },
      );

      if (!res.ok) {
        // Backend contract: {'error': '...'} on every non-2xx — e.g. the
        // 400 above, if the listing's status changed in another tab
        // between this page rendering and the click landing.
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ??
            `Could not submit for review (HTTP ${res.status})`,
        );
      }

      setPhase("success");
      // Raw POST, not a cache-aware mutation — invalidate manually so
      // the preview (detail query) and the grid (list query) re-run.
      // Both live under ["api", "listings"], one call refreshes both.
      invalidate("listings");
    } catch (err) {
      setPhase("error");
      setError(errorMessage(err, "Could not submit for review"));
    }
  }

  return { submit, phase, error, isSubmitting: phase === "submitting" };
}
