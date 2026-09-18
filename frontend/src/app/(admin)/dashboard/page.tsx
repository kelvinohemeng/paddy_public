import { redirect } from "next/navigation";
import { cookies } from "next/headers";

// "/dashboard" is a pure REDIRECT, not a real page — it exists so the
// sidebar (see _refine_context.tsx's "dashboard" resource) always has
// one stable, always-resolvable link, regardless of who's logged in.
// Refine's menu can auto-fill a record ":id" but has no way to
// auto-fill a raw ":user" route segment for a generic nav link, so
// this route does that resolution itself: read the current session's
// user id server-side, then send the browser on to the REAL
// destination at /dashboard/[user]/listings.
//
// Same auth-check shape as (admin)/layout.tsx's own /accounts/me/
// call (this route sits inside that same layout, so unauthenticated
// requests are already caught there — this fetch only needs the id).

export default async function DashboardRedirectPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/accounts/me/`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    redirect("/login");
  }

  const user = await response.json();
  redirect(`/dashboard/${user.id}/listings`);
}
