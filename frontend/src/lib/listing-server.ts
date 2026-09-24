import { cookies } from "next/headers";

// Server-side listing fetch shared by the full Property Detail page
// (homes/[id]/page.tsx) and the Discovery Hub's preview drawer
// (@modal/(.)homes/[id]/page.tsx) — both must see the SAME gated
// response, so the auth/caching rules live in exactly one place.
//
// UNLOCK GATING + AUTH: forwards the browser's access_token cookie to
// the backend when one exists. That is what makes the pay-to-unlock
// flow visible: ListingSerializer._has_access reads the request's
// user — an anonymous fetch can never see is_unlocked=true or the
// gated address_precise/landlord_contact, even for a user who paid.
// Crawlers/anonymous visitors get the identical anonymous response,
// so SEO semantics are unchanged.
//
// Caching: a logged-in response must never be cached/shared, so it's
// no-store; the anonymous branch keeps the 60s revalidate.
export async function fetchListingForViewer(id: string) {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;

  const url = `${process.env.NEXT_PUBLIC_API_URL}/listings/${id}/`;
  const anonymous = () =>
    fetch(url, { cache: "force-cache", next: { revalidate: 60 } });

  let res = token
    ? await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
    : await anonymous();

  // A dead/expired token makes SimpleJWT 401 even on this public
  // endpoint. proxy.ts refreshes the cookie before we get here, but if
  // that couldn't happen, show the public (locked) view rather than
  // "Listing not found".
  if (token && res.status === 401) {
    res = await anonymous();
  }

  return {
    listing: res.ok ? await res.json() : null,
    // Cookie presence only — enough to pick which CTA state renders,
    // same check (admin)/layout.tsx uses. Real role checks happen on
    // the backend for every action.
    isAuthenticated: Boolean(token),
  };
}
