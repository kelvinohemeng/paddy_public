"use client";

import { SideDrawer } from "@/components/side-drawer";

// Figma "Discovery Page - Listing Detail" (171:2570): the listing slides
// in from the right over the hub. Closing returns to /homes with the map
// and scroll position untouched; expanding hard-navigates to the full
// /homes/[slug] page. The drawer itself is the shared <SideDrawer>, so
// the dashboard's listing panels open and close the same way.
export function ListingDetailDrawer({
  listingSlug,
  children,
}: {
  listingSlug: string;
  children: React.ReactNode;
}) {
  return (
    <SideDrawer title="Listing preview" expandHref={`/homes/${listingSlug}`}>
      {children}
    </SideDrawer>
  );
}
