// Public Property Detail page (AGENTS.md build-priority #2) — the full-
// page version of the Discovery Hub's preview drawer (Figma "Discovery
// Page - Listing Detail - Expanded", 172:18259). Reached by a direct
// visit, a refresh, a shared link or the drawer's expand button;
// clicking a card on /homes opens @modal/(.)homes/[id] instead.
//
// Server component for SEO: a listing page is exactly the kind of URL
// organic search traffic lands on, so it needs real server-rendered
// HTML on first load. `is_unlocked`/`address_precise`/`landlord_contact`
// come straight from ListingSerializer, already gated server-side
// (_has_access) — see lib/listing-server.ts for the token forwarding.
//
// Still deferred: the photosphere "Take Live Tour" (separate viewer
// component, build-priority #2).

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { fetchListingForViewer } from "@/lib/listing-server";
import { DiscoveryHeader } from "../../_components/discovery-header";
import { DISCOVERY_PATH } from "../../_components/discovery-path";
import { ListingDetail } from "./_components/listing-detail";

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { listing, isAuthenticated } = await fetchListingForViewer(id);

  return (
    <div className="min-h-svh bg-white">
      <header className="border-b p-3 md:p-4">
        <div className="mx-auto max-w-6xl">
          <DiscoveryHeader />
        </div>
      </header>

      <div className="mx-auto max-w-[845px] px-5 pt-6 pb-4 md:px-8">
        <Link
          href={DISCOVERY_PATH}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-black/70 hover:text-black"
        >
          <ArrowLeft className="size-4" />
          All homes
        </Link>
      </div>

      {listing ? (
        <ListingDetail listing={listing} isAuthenticated={isAuthenticated} />
      ) : (
        <p className="text-muted-foreground p-6 text-center">
          Listing not found — it may have been unpublished or removed.
        </p>
      )}
    </div>
  );
}
