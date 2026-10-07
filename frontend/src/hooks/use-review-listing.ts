"use client";

import { useState } from "react";
import { useApiInvalidate } from "@/hooks/use-api";
import { authedFetch, errorMessage } from "@/lib/api";

// Staff/admin half of the verification workflow (backend PR #18,
// merged to main) — the mirror of use-submit-for-review.ts:
//   POST /listings/<id>/review/   {decision: "published" | "rejected"}
//   - Staff-or-admin only (landlord/renter get 403, anonymous 401 —
//     the role check runs FIRST server-side, so a wrong-role call
//     surfaces "Only staff or admins can review listings", never a
//     misleading validation error).
//   - Only from pending_review — drafts, published, archived all 400
//     {'error': 'Only listings pending review can be reviewed'}.
//   - Bad decision value 400 {'error': 'decision must be "published"
//     or "rejected"'}.
//   - Success: 200 with the FULL re-serialized listing. The consumers
//     here invalidate the listings list (the decided row leaves the
//     pending queue, which IS the state update the UI needs) rather
//     than hand-merging the response — same invalidation pattern as
//     use-submit-for-review.ts, since both are raw POSTs outside
//     Refine's provider calls.

export type ReviewDecision = "published" | "rejected";

type Phase = "idle" | "submitting" | "success" | "error";

export function useReviewListing(listingId: string | number) {
  const invalidate = useApiInvalidate();

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [decidedAs, setDecidedAs] = useState<ReviewDecision | null>(null);

  async function review(decision: ReviewDecision, reason?: string) {
    if (phase === "submitting") return;
    setPhase("submitting");
    setError(null);

    try {
      const res = await authedFetch(`/listings/${listingId}/review/`, {
        method: "POST",
        json: { decision, reason },
      });

      if (!res.ok) {
        // Backend contract: {'error': '...'} on every non-2xx — e.g.
        // the 400 above if another reviewer decided first in another
        // tab between this queue rendering and the click landing.
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ??
            `Could not review listing (HTTP ${res.status})`,
        );
      }

      setDecidedAs(decision);
      setPhase("success");
      // Decided rows leave the pending queue — invalidate so the queue
      // re-runs. Both list and detail queries live under the ["api",
      // "listings"] key prefix, so one invalidation refreshes both.
      invalidate("listings");
    } catch (err) {
      setPhase("error");
      setError(errorMessage(err, "Could not review listing"));
    }
  }

  return {
    review,
    phase,
    error,
    decidedAs,
    isSubmitting: phase === "submitting",
  };
}
