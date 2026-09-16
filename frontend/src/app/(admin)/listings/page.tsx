"use client";
// Required — useList (below) is a client-side hook (manages state,
// re-fetches reactively in the browser). Next.js's App Router treats
// every file as a SERVER component by default unless this directive
// is present, and a server component genuinely cannot call a client
// hook at all — this is a hard runtime error, not a style choice.

import { useList } from "@refinedev/core";
import Link from "next/link";
// Link, not <a> — Next.js's client-side navigation component. Using
// it (instead of a plain anchor tag) is what makes the intercepting
// route below actually trigger as a MODAL instead of a full page
// reload. A hard navigation (typing the URL directly, or a plain <a>)
// bypasses interception entirely and renders the real full page.

export default function ListingsPage() {
  // useList — Refine's generic "fetch a list of a resource" hook. It
  // reads the CURRENT route to infer resource="listings" (since this
  // file lives under a route matching the "listings" entry we
  // registered in _refine_context.tsx), then internally calls
  // dataProvider.getList({ resource: "listings" }) — the exact same
  // generic function you wrote by hand earlier, with zero
  // listings-specific code inside it.
  //
  // Refine v5 nests the return value as { query, result } rather than
  // the flatter { data, isLoading, isError } shape older docs/examples
  // show (a real breaking change between major versions) — confirmed
  // against this project's actual installed @refinedev/core version
  // via a real TypeScript error, not assumed from memory.
  const { query, result } = useList({
    resource: "listings",
  });

  if (query.isLoading) {
    return <p className="p-6">Loading listings...</p>;
  }

  if (query.isError) {
    // A real, visible failure state — worth having explicitly rather
    // than letting a failed fetch render a silently empty list, which
    // would be indistinguishable from "zero listings exist yet"
    return <p className="p-6 text-red-500">Failed to load listings.</p>;
  }

  const listings = result?.data ?? [];
  // result.data — the actual array of listings. result.total also
  // exists here for pagination, unused for now since this is a first
  // pass at just proving the create flow works end to end.

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Listings</h1>

        <Link
          href="/listings/create"
          className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          New Listing
        </Link>
        {/* This Link's href is the SAME "/listings/create" URL Refine's
            resource registration already points "create" at. Nothing
            about the URL changes because of the modal pattern — what
            changes is HOW Next.js decides to render whatever's at that
            URL, based on whether navigation happened via this Link
            (client-side, intercepted -> modal) or a hard refresh/direct
            visit (full page, see the create/page.tsx fallback below) */}
      </div>

      {listings.length === 0 ? (
        <p className="text-muted-foreground">
          No listings yet — create your first one to get started.
        </p>
      ) : (
        <ul className="space-y-3">
          {listings.map((listing: any) => (
            <li
              key={listing.id}
              className="rounded-md border p-4 flex items-center justify-between"
            >
              <div>
                <p className="font-medium">{listing.title}</p>
                <p className="text-sm text-muted-foreground">
                  {listing.city} · {listing.bedrooms} bd / {listing.bathrooms}{" "}
                  ba
                </p>
              </div>
              <span className="text-sm rounded-full bg-muted px-2 py-1">
                {listing.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
