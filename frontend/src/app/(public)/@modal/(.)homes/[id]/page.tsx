import { fetchListingForViewer } from "@/lib/listing-server";
import { ListingDetail } from "../../../homes/[id]/_components/listing-detail";
import { ListingDetailDrawer } from "../../../homes/[id]/_components/listing-detail-drawer";

// Discovery Hub preview (Figma "Discovery Page - Listing Detail",
// 171:2570): clicking a card on /homes opens the listing in a right-
// hand drawer over the hub, keeping the map and scroll position. The
// URL still becomes /homes/[id], so it's shareable — a direct visit or
// refresh skips this interception and renders the full page instead
// (homes/[id]/page.tsx, Figma's "Expanded" frame).
export default async function InterceptedListingPreview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { listing, isAuthenticated } = await fetchListingForViewer(id);

  return (
    <ListingDetailDrawer listingId={id}>
      {listing ? (
        <ListingDetail listing={listing} isAuthenticated={isAuthenticated} />
      ) : (
        <p className="text-muted-foreground p-8 text-center text-sm">
          Listing not found — it may have been unpublished or removed.
        </p>
      )}
    </ListingDetailDrawer>
  );
}
