"use client";

import { SideDrawer } from "@/components/side-drawer";
import { ListingFormStepper } from "@/app/(admin)/dashboard/[user]/listings/_components/listing-form-stepper";

// Intercepts client-side navigation to /dashboard/[user]/listings/create
// and opens the form in the shared right-hand drawer — the same slide-in
// and expand as Discovery's listing preview. A hard load/refresh falls
// through to the real listings/create/page.tsx full page instead.
//
// Expanding widens the drawer in place rather than navigating, so the
// <ListingFormStepper /> never unmounts: half-filled values and picked
// File objects survive the toggle with zero storage code. Clicking the
// dimmed page doesn't close it (would discard the form); Esc and the
// close button do. The stepper puts its Back / Next in this drawer's
// header row itself (SideDrawer's actions slot); below md the drawer is
// full-screen and they sit in a bar at the bottom instead.
export default function InterceptedListingCreatePanel() {
  return (
    <SideDrawer
      title="Create listing"
      showTitle
      subtitle="Five short steps — nothing is saved until the last one."
      dismissOnOutsideClick={false}
      bodyClassName="px-5 pb-8 md:px-8"
    >
      <ListingFormStepper />
    </SideDrawer>
  );
}
