// This is the FULL-PAGE fallback. Next.js renders THIS file (not the
// modal) whenever /dashboard/[user]/listings/create is reached
// WITHOUT client-side navigation from the list page — e.g. someone
// pastes the URL directly, hits refresh while the modal is open, or a
// search engine crawls it. Intercepting routes only intercept
// navigation that happens WITHIN the app via <Link>/router.push — a
// hard load always falls through to this real, ordinary page instead.
//
// This guarantees the create URL is never a "broken" URL that only
// half-works depending on how you arrived at it — worst case, someone
// gets the plain full-page form instead of the modal, which is a
// completely reasonable, working experience either way.

import { ListingCreateForm } from "../_components/listing-create-form";

export default function ListingCreatePage() {
  return (
    <div className="max-w-xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Create Listing</h1>
      <ListingCreateForm />
    </div>
  );
}
