// FULL-PAGE fallback for the listing preview. Renders whenever
// /dashboard/[user]/listings/[id] is reached WITHOUT client-side
// navigation from the list page's card grid (direct URL, refresh,
// crawler) — same intercepting-route pattern as create/edit above.

import { ListingPreview } from "../_components/listing-preview";

export default async function ListingShowPage({
  params,
}: {
  params: Promise<{ user: string; id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <ListingPreview listingId={id} />
    </div>
  );
}
