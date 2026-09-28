// This is the FULL-PAGE fallback for editing a listing. Next.js renders
// THIS file (not the modal) whenever /dashboard/[user]/listings/[id]/edit
// is reached WITHOUT client-side navigation from a listing card/preview
// — e.g. someone pastes the URL directly, hits refresh while the modal
// is open, or a search engine crawls it. Same pattern as
// listings/create/page.tsx's relationship to its own intercepted panel.

import { ListingFormStepper } from "../../_components/listing-form-stepper";

export default async function ListingEditPage({
  params,
}: {
  params: Promise<{ user: string; id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="font-display mb-6 text-2xl font-medium tracking-[-0.02em]">Edit listing</h1>
      <ListingFormStepper listingId={id} />
    </div>
  );
}
