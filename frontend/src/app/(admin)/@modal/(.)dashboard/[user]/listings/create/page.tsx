"use client";

import { SideDrawer } from "@/components/side-drawer";
import { ListingCreateForm } from "@/app/(admin)/dashboard/[user]/listings/_components/listing-create-form";

// Intercepts client-side navigation to /dashboard/[user]/listings/create
// and opens the form in the shared right-hand drawer — the same slide-in
// and expand as Discovery's listing preview. A hard load/refresh falls
// through to the real listings/create/page.tsx full page instead.
//
// Expanding widens the drawer in place rather than navigating, so the
// <ListingCreateForm /> never unmounts: half-filled values and picked
// File objects survive the toggle with zero storage code. Clicking the
// dimmed page doesn't close it (would discard the form); Esc and the
// close button do.
export default function InterceptedListingCreatePanel() {
  return (
    <SideDrawer
      title="Create listing"
      showTitle
      subtitle="Add photos and details — the list updates once saved."
      dismissOnOutsideClick={false}
      bodyClassName="px-5 pb-8 md:px-8"
    >
      <ListingCreateForm />
    </SideDrawer>
  );
}
