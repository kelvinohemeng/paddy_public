"use client";

import { use, useState } from "react";
import { SideDrawer } from "@/components/side-drawer";
import {
  ListingOwnerActions,
  ListingPreview,
  listingStatusHint,
  useListingStatus,
} from "@/app/(admin)/dashboard/[user]/listings/_components/listing-preview";
import { ListingCreateForm } from "@/app/(admin)/dashboard/[user]/listings/_components/listing-create-form";

// Drawer for the listing PREVIEW — the shared right-hand drawer, same
// slide-in and expand as Discovery's listing preview, and the same body:
// the Discovery ListingDetail in owner view. The owner's actions (Submit
// for review / Archive or Restore / Update listing) sit at the right end
// of the drawer's close/expand row. Intercepts client-side navigation to
// /dashboard/[user]/listings/[id]; a hard load/refresh falls through to
// the real listings/[id]/page.tsx.
//
// Does double duty as BOTH the preview AND, once "Update listing" is
// clicked, the edit form — toggled locally rather than navigating to a
// second intercepted route, so the drawer doesn't flicker closed/reopen
// for what's conceptually the same "looking at this one listing"
// session. Saving or cancelling returns to the preview. Clicking the
// dimmed page closes the preview, but not the form (it would discard
// unsaved edits).
export default function InterceptedListingShowPanel({
  params,
}: {
  params: Promise<{ user: string; id: string }>;
}) {
  const { id } = use(params);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const editing = mode === "edit";
  const status = useListingStatus(id);

  return (
    <SideDrawer
      title={editing ? "Edit listing" : "Listing preview"}
      showTitle
      subtitle={
        editing
          ? "Update details — the preview refreshes once saved."
          : listingStatusHint(status)
      }
      dismissOnOutsideClick={!editing}
      actions={
        editing ? undefined : (
          <ListingOwnerActions listingId={id} onEdit={() => setMode("edit")} />
        )
      }
      // ListingDetail pads itself (it's the same component Discovery's
      // drawer renders); only the form needs padding from the drawer.
      bodyClassName={editing ? "px-5 pb-8 md:px-8" : undefined}
    >
      {editing ? (
        <ListingCreateForm
          listingId={id}
          onSuccess={() => setMode("preview")}
          onCancel={() => setMode("preview")}
        />
      ) : (
        <ListingPreview listingId={id} />
      )}
    </SideDrawer>
  );
}
