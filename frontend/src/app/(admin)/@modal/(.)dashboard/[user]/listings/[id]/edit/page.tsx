"use client";

import { use } from "react";
import { SideDrawer } from "@/components/side-drawer";
import { ListingCreateForm } from "@/app/(admin)/dashboard/[user]/listings/_components/listing-create-form";

// Drawer for EDITING a listing directly (client-side nav to
// /dashboard/[user]/listings/[id]/edit — e.g. the "Edit Listing" link on
// the full-page preview fallback). A hard load/refresh falls through to
// the real listings/[id]/edit/page.tsx full page.
//
// A separate route from @modal/(.)dashboard/[user]/listings/[id]/page.tsx
// (which toggles preview -> edit INSIDE one open drawer) because Next.js
// intercepting routes match on the URL actually being navigated to — a
// direct link to .../edit needs its own interceptor at that exact path.
export default function InterceptedListingEditPanel({
  params,
}: {
  params: Promise<{ user: string; id: string }>;
}) {
  const { id } = use(params);

  return (
    <SideDrawer
      title="Edit listing"
      showTitle
      subtitle="Update details — the list refreshes once saved."
      dismissOnOutsideClick={false}
      bodyClassName="px-5 pb-8 md:px-8"
    >
      <ListingCreateForm listingId={id} />
    </SideDrawer>
  );
}
