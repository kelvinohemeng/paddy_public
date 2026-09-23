import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { OnboardingForm } from "@/components/auth/onboarding-form";
import { authServer } from "@/lib/auth-server";

// Server-side guard (2026-09-23): re-checks role on every direct
// navigation to /onboarding. Without this, a user who already
// onboarded could bookmark/revisit /onboarding and see the form
// again. Mirrors (admin)/layout.tsx's own /accounts/me/ check.
// NOTE: no automatic post-login funnel here exists yet (see
// onboarding-form.tsx) — this guard only covers direct navigation.

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

  if (user.role !== null) {
    // Already onboarded — nothing to do here, send them on to the
    // normal post-login landing spot.
    redirect("/dashboard");
  }

  return <OnboardingForm />;
}
