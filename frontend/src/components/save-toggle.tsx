"use client";

// Save/unsave toggle for listings (renters only). Mounted on the public
// discovery card and the property detail page, keyed off the backend's
// computed `is_saved` flag (ListingSerializer) so no second fetch is
// needed for initial state.
//
// Contract (backend/listings/views.py save_listing action):
//   POST   /listings/<id>/save/ → 201 (created) or 200 (already saved)
//   DELETE /listings/<id>/save/ → 204 (no-op if never saved — not an error)
// Non-renters 403; anonymous visitors get no toggle at all (parent hides
// it — saving requires a renter session, and the backend would 403/401
// any attempt anyway).
//
// Uses authedFetch directly (NOT the generic api-client): the 204
// no-body unsave response needs no JSON parsing, and this is a
// per-listing action, not a resource CRUD call — same reasoning as
// use-submit-for-review.ts.

import { useState } from "react";
import { Heart, Loader2 } from "lucide-react";
import { authedFetch, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

export function SaveToggle({
  listingId,
  initialSaved,
}: {
  listingId: number | string;
  initialSaved: boolean;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(e: React.MouseEvent) {
    // Parent is usually a Link (card) — never navigate on toggle.
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      const res = await authedFetch(`/listings/${listingId}/save/`, {
        method: saved ? "DELETE" : "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ??
            `Could not ${saved ? "unsave" : "save"} this home (HTTP ${res.status})`,
        );
      }
      // 204 (unsave) has no body — flip from intent, not from parsing.
      setSaved(!saved);
    } catch (err) {
      setError(errorMessage(err, "Could not save this home"));
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={saved}
        aria-label={saved ? "Unsave this home" : "Save this home"}
        title={saved ? "Unsave this home" : "Save this home"}
        className={cn(
          "inline-flex items-center justify-center rounded-full border bg-white/90 p-1.5 shadow-sm transition hover:scale-105",
          saved ? "text-red-500" : "text-muted-foreground",
        )}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Heart className={cn("size-4", saved && "fill-current")} />
        )}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </span>
  );
}
