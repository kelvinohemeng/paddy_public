import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { needsOnboarding } from "@/lib/onboarding";

// "/dashboard" is a pure REDIRECT, not a real page — it exists as the
// stable post-login landing URL (useLogin in hooks/use-auth.ts
// redirects here), resolving the current session's username and role
// server-side and sending the browser on to that role's main page.
//
// There is no dashboard home page (Kelvin, 2026-10-01): each section
// on the old one was a smaller copy of another page. So the dashboard
// opens where each role actually works — see landingPath below.
// (Refine's menu can auto-fill a record ":id" but has no way to
// auto-fill a raw ":user" route segment, so this route does that
// resolution itself, server-side.)
//
// Same auth-check shape as (admin)/layout.tsx's own /accounts/me/
// call (this route sits inside that same layout, so unauthenticated
// requests are already caught there — this fetch only needs the
// username and role).

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
  redirect(landingPath(user));
}

function landingPath(user: { username?: string | null; role?: string | null }): string {
  // No role or no username yet: the person signed up but never picked
  // renter/landlord, or the account predates usernames (staff/admin
  // accounts made in Django admin too). Onboarding fills in what's
  // missing and sends them back here. needsOnboarding is shared with
  // app/onboarding/page.tsx so the two pages always agree.
  if (needsOnboarding(user)) return "/onboarding";

  // The URL segment after /dashboard/ is the person's username (it used
  // to be their numeric id). Nothing reads it back: every page loads the
  // signed-in person's own data from their token, so it only names the
  // page. Old /dashboard/<id>/… bookmarks therefore still open.
  const base = `/dashboard/${user.username}`;
  switch (user.role) {
    case "landlord":
      return `${base}/listings`;
    case "staff":
    case "admin":
      return `${base}/reviews`;
    case "renter":
      return `${base}/saved`;
    default:
      // A role this page doesn't know. Not /onboarding: that page sees a
      // role and sends people straight back here, which would loop.
      return "/";
  }
}
