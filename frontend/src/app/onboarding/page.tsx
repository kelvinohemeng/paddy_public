import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { OnboardingForm } from "@/components/auth/onboarding-form";
import { authServer } from "@/lib/auth-server";
import { needsOnboarding, needsRole, needsUsername } from "@/lib/onboarding";

// Server-side guard (2026-09-23): re-checks the account on every
// navigation to /onboarding. Without this, a user who already
// onboarded could bookmark/revisit /onboarding and see the form
// again. Mirrors (admin)/layout.tsx's own /accounts/me/ check.
// The way IN is /dashboard (app/(admin)/dashboard/page.tsx), which
// sends every login here while the account lacks a role or username.

export default async function OnboardingPage() {
  const { authenticated } = await authServer.check();

  if (!authenticated) {
    redirect("/login");
  }

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

  if (!needsOnboarding(user)) {
    // Already onboarded (a role AND a username) — nothing to do here,
    // send them on to the normal post-login landing spot. needsOnboarding
    // is the same check /dashboard uses to send people here, so the two
    // pages can't bounce someone back and forth.
    redirect("/dashboard");
  }

  // The form pre-fills from what the account already has: the names
  // Google gave us, or the ones typed at sign-up. Role and username are
  // only asked for when they're still missing.
  return (
    <OnboardingForm
      account={{
        email: user.email,
        firstName: user.first_name ?? "",
        lastName: user.last_name ?? "",
        asksRole: needsRole(user),
        asksUsername: needsUsername(user),
      }}
    />
  );
}
