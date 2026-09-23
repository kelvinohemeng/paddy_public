// FULL-PAGE fallback for the listing preview. Renders whenever
// /dashboard/[user]/listings/[id] is reached WITHOUT client-side
// navigation from the list page's card grid (direct URL, refresh,
// crawler) — same intercepting-route pattern as create/edit above.
//
// Unlike the docked panel (which toggles preview->edit via local state
// inside the aside), this full-page version had no inline edit path —
// "Edit Listing" used to navigate to the separate /edit route. Now it
// toggles the SAME shared component the creation/update routes use
// (ListingCreateForm, in edit mode via listingId) right here on the
// page, matching the panel's preview->edit behavior. The /edit route
// still exists as a deep-linkable URL; this toggle is just the
// in-place way to get there without a navigation.

"use client";

import { use, useState } from "react";
import { ListingPreview } from "../_components/listing-preview";
import { ListingCreateForm } from "../_components/listing-create-form";

export default function ListingShowPage({
  params,
}: {
  params: Promise<{ user: string; id: string }>;
}) {
  const { id } = use(params);
  const [mode, setMode] = useState<"view" | "edit">("view");

  return (
    <div className="mx-auto max-w-2xl p-6">
      {mode === "edit" ? (
        <>
          <h1 className="mb-6 text-2xl font-bold">Update Listing</h1>
          <ListingCreateForm
            listingId={id}
            // Both callbacks flip straight back to the (refetched)
            // preview without any navigation — the URL never changed,
            // so router.push/back would only take the user elsewhere.
            onSuccess={() => setMode("view")}
            onCancel={() => setMode("view")}
          />
        </>
      ) : (
        <>
          <h1 className="mb-6 text-2xl font-bold">Listing Preview</h1>
          <ListingPreview listingId={id} onEdit={() => setMode("edit")} />
        </>
      )}
    </div>
  );
}