import { redirect } from "next/navigation";
import { authProviderServer } from "@/providers/auth-provider/auth-provider.server";
import { cookies } from "next/headers";
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
  const { authenticated } = await authProviderServer.check();

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

  if (user.role !== "landlord") {
    // Landlords create/manage their own listings; staff verify/manage
    // listings too; admins also need access here (revised — originally
    // scoped to just landlord/staff, with admin routed through Django's
    // own admin panel instead, but that was reconsidered).
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen w-full items-stretch">
      <div className="min-w-0 flex-1">{children}</div>
      {modal}
      {/* Parallel-route slot rendered as a SIBLING flex column, not an
          overlay — when @modal/default.tsx is active (null) this adds
          nothing and children take full width; when the intercepted
          create route is active, its <aside> docks on the right and
          physically squeezes children, so the panel occupies space in
          the layout instead of floating over it. */}
    </div>
  );
}
