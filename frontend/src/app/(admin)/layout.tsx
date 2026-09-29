import { redirect } from "next/navigation";
import { authServer } from "@/lib/auth-server";
import { cookies } from "next/headers";
import { AdminChrome } from "./_chrome/admin-chrome";
// Your existing server-side auth provider — reads the cookie,
// not localStorage, since this code runs on the server, where
// localStorage doesn't exist at all

export default async function AdminLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
  // "modal" here is NOT a prop you pass manually anywhere — Next.js
  // automatically supplies it because a sibling folder is named
  // "@modal". The name after @ becomes the exact prop name the
  // layout receives. Whatever page currently matches under @modal
  // (either the intercepted create form, or its default.tsx null)
  // arrives here as this prop, already resolved.
}) {
  const { authenticated } = await authServer.check();

  if (!authenticated) {
    redirect("/login");
    // next/navigation's redirect() — throws internally to stop
    // rendering immediately and send the browser to /login instead.
    // Nothing under (admin) ever renders if this fires.
  }

  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;

  if (!process.env.NEXT_PUBLIC_API_URL) {
    console.error("NEXT_PUBLIC_API_URL is not set. Returning to login.");
    return null; // Or redirect() if it's guaranteed to work
  }

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/accounts/me/`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      // no-store = never cache this — role can change, and this is a
      // security check, not content that's safe to serve stale
    },
  );

  if (!response.ok) {
    redirect("/login");
    // Was redirecting to "/" — but a failed /accounts/me/ call here
    // means the token is invalid/expired, effectively the same as
    // "not authenticated" at all. Sending to /login gives a clear
    // signal to sign back in, rather than silently landing on a
    // public page with no explanation.
  }

  const user = await response.json();

  // All authenticated roles pass here — renters included. Renter pages
  // (leases, saved homes, profile) live under this same dashboard area,
  // so a blanket renter block would lock them out entirely. Role-specific
  // restrictions (e.g. listing management is landlord/staff-only) are
  // enforced per-page, not at this layout gate.

  // Chrome (sidebar + header + logout) renders via the AdminChrome
  // client wrapper below — server layouts can't render the client
  // sidebar/header directly with server-rendered children, hence the
  // indirection.
  return (
    <AdminChrome modal={modal}>
      {/* flex column so a page's empty state (flex-1) can fill the panel
          and centre itself, as in the Figma "No Property" frame. */}
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </AdminChrome>
  );
}
