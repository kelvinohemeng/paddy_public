import { redirect } from "next/navigation";
import { cookies } from "next/headers";

// "/dashboard" is a pure REDIRECT, not a real page — it exists as the
// stable post-login landing URL (useLogin in hooks/use-auth.ts
// redirects here), resolving the current session's user id server-side and sending the
// browser on to the REAL homepage at /dashboard/[user].
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
  // Every role lands on the dashboard homepage — role-aware cards
  // there (not here) decide what each user sees first.
  redirect(`/dashboard/${user.id}`);
}
