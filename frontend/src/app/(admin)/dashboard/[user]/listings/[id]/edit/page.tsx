// This is the FULL-PAGE fallback for editing a listing. Next.js renders
// THIS file (not the modal) whenever /dashboard/[user]/listings/[id]/edit
// is reached WITHOUT client-side navigation from a listing card/preview
// — e.g. someone pastes the URL directly, hits refresh while the modal
// is open, or a search engine crawls it. Same pattern as
// listings/create/page.tsx's relationship to its own intercepted panel.

import { ListingCreateForm } from "../../_components/listing-create-form";

export default async function ListingEditPage({
  params,
}: {
  params: Promise<{ user: string; id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="max-w-xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Edit Listing</h1>
      <ListingCreateForm listingId={id} />
    </div>
  );
}
