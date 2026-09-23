"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Cookies from "js-cookie";

import { RoleCard } from "@/components/role-card";
import { PaddyButton } from "@/components/paddy-button";
import { Logo } from "@/components/logo";
import {
  OnboardingFormValues,
  onboardingSchema,
} from "@schemas/auth.schema";

// New screen (2026-09-23) — role selection moved here from Signup so
// EVERY auth path (email/password login, Google sign-in, register)
// can funnel through the same gate. NOTE: no automatic post-login
// funnel here exists yet (neither the old auth-provider nor
// hooks/use-auth implements the role:null redirect); the screen is
// currently reached directly. See app/onboarding/page.tsx for the
// server-side guard that re-checks this on direct navigation (a user
// who already onboarded hitting /onboarding by URL gets redirected
// away, not shown the form again).
//
// Backend contract (paddy backend agent handoff, confirmed):
//   POST /accounts/onboarding/   (Bearer token required)
//   -> { role: "renter" | "landlord" }
//   <- 200 <full UserSerializer, role now set>
//   <- 400 { error: "Role has already been set for this account and cannot be changed here." }
//   <- 400 { error: 'role must be either "renter" or "landlord".' }
//   <- 401 (not authenticated)
// Strictly one-time — matches the "this choice is permanent" copy
// signup's old role picker used to show.

export function OnboardingForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<OnboardingFormValues>({
    resolver: zodResolver(onboardingSchema),
  });

  const handleOnboard = async (data: OnboardingFormValues) => {
    setPending(true);
    setError(null);
    try {
      const token =
        Cookies.get("access_token") ?? localStorage.getItem("access_token");
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/accounts/onboarding/`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ role: data.role }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push("/dashboard");
        return;
      }
      setError(
        (body as { error?: string }).error ??
          "Could not save your role. Try again in a moment.",
      );
    } catch {
      setError(
        "Could not reach the server — check your connection and try again.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-10 px-6 py-10">
      <Logo className="text-3xl" />

      <div className="w-full max-w-sm text-center">
        <h1 className="mb-2 text-[28px] font-semibold text-[#111111]">
          You are…
        </h1>
        <p className="text-muted-foreground mb-6 text-sm">
          Pick how you'll use paddy. This can't be changed later.
        </p>

        <form onSubmit={handleSubmit(handleOnboard)} className="space-y-6">
          <Controller
            name="role"
            control={control}
            render={({ field }) => (
              <div className="flex items-center justify-center gap-4">
                <RoleCard
                  role="Landlord"
                  state={field.value === "landlord" ? "selected" : "default"}
                  onSelect={() => field.onChange("landlord")}
                />
                <RoleCard
                  role="Renter"
                  state={field.value === "renter" ? "selected" : "default"}
                  onSelect={() => field.onChange("renter")}
                />
              </div>
            )}
          />
          {errors.role && (
            <p className="text-sm text-red-500">{errors.role.message}</p>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}

          <PaddyButton
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            isLoading={pending}
          >
            Continue
          </PaddyButton>
        </form>
      </div>
    </div>
  );
}

OnboardingForm.displayName = "OnboardingForm";
