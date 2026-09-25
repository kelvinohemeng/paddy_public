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
//
// slug-or-id: new links carry the slug (/homes/cozy-studio-osu) and hit
// by-slug first; old id links (/homes/123) fall back to /listings/<id>/
// so bookmarks made before slugs keep working.
export async function fetchListingForViewer(slugOrId: string) {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  const base = process.env.NEXT_PUBLIC_API_URL;
  const slugUrl = `${base}/listings/by-slug/${encodeURIComponent(slugOrId)}/`;
  const idUrl = `${base}/listings/${encodeURIComponent(slugOrId)}/`;

  const get = (url: string, authed: boolean) =>
    fetch(
      url,
      authed
        ? { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
        : { cache: "force-cache", next: { revalidate: 60 } },
    );

  let res = token ? await get(slugUrl, true) : await get(slugUrl, false);

  // A dead/expired token makes SimpleJWT 401 even on this public
  // endpoint. proxy.ts refreshes the cookie before we get here, but if
  // that couldn't happen, show the public (locked) view rather than
  // "Listing not found".
  if (token && res.status === 401) {
    res = await get(slugUrl, false);
  }
  // Old id-based URLs: by-slug 404s for a numeric id, so retry the
  // classic retrieve endpoint before giving up.
  if (res.status === 404) {
    const fallback = token ? await get(idUrl, true) : await get(idUrl, false);
    if (fallback.ok || (token && fallback.status !== 401)) {
      res = fallback;
    } else if (token && fallback.status === 401) {
      res = await get(idUrl, false);
    }
  }

  return {
    listing: res.ok ? await res.json() : null,
    // Cookie presence only — enough to pick which CTA state renders,
    // same check (admin)/layout.tsx uses. Real role checks happen on
    // the backend for every action.
    isAuthenticated: Boolean(token),
  };
}
