import { redirect } from "next/navigation";
import { cookies } from "next/headers";

// "/dashboard" is a pure REDIRECT, not a real page — it exists as the
// stable post-login landing URL (useLogin in hooks/use-auth.ts
// redirects here), resolving the current session's user id and role
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
  redirect(landingPath(user.id, user.role));
}

function landingPath(userId: string | number, role: string | null): string {
  const base = `/dashboard/${userId}`;
  switch (role) {
    case "landlord":
      return `${base}/listings`;
    case "staff":
    case "admin":
      return `${base}/reviews`;
    case "renter":
      return `${base}/saved`;
    default:
      // No role yet: the user signed up but never picked renter or
      // landlord, so no page is theirs. Onboarding sets the role and
      // sends them back here.
      return "/onboarding";
  }
}
