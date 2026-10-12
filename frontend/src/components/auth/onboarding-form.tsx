"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { RoleCard } from "@/components/role-card";
import { PaddyButton } from "@/components/paddy-button";
import { Logo } from "@/components/logo";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ME_QUERY_KEY } from "@/hooks/use-auth";
import { authedFetch } from "@/lib/api";
import {
  OnboardingFormValues,
  USERNAME_PATTERN,
  onboardingSchema,
} from "@schemas/auth.schema";

// New screen (2026-09-23) — role selection moved here from Signup so
// EVERY auth path (email/password login, Google sign-in, register)
// can funnel through the same gate. Since 2026-10-12 it also asks for
// first name, last name and a username (the slug in dashboard URLs,
// /dashboard/<username>/…, replacing the numeric user id).
//
// How people get here: /dashboard (app/(admin)/dashboard/page.tsx)
// sends any account missing a role OR a username here, and
// app/onboarding/page.tsx sends finished accounts back. That page also
// passes `account` in, so the form starts pre-filled: Google sign-ups
// arrive with Google's first/last name, email sign-ups with the names
// typed at sign-up, and a username suggested from the name.
//
// Backend contract (backend/accounts/views.py onboarding):
//   POST /accounts/onboarding/   (Bearer token required)
//   -> { first_name, last_name, username?, role? }
//      username/role only while the account has none; sending one the
//      account already has is a 400.
//   <- 200 <full UserSerializer, now with role + username>
//   <- 400 { error: "..." }                    role / one-time rules
//   <- 400 { username: ["That username is taken. Try another one."] }
//          (per-field lists, shown under the matching input)
//   <- 401 (not authenticated)
// Strictly one-time — matches the "this choice is permanent" copy
// signup's old role picker used to show.

export type OnboardingAccount = {
  email: string;
  firstName: string;
  lastName: string;
  /** The account has no role yet, so the role cards are shown. */
  asksRole: boolean;
  /** The account has no username yet, so the username field is shown. */
  asksUsername: boolean;
};

// Django's field names → this form's, for putting a 400's per-field
// messages under the right input.
const SERVER_FIELDS = {
  first_name: "firstName",
  last_name: "lastName",
  username: "username",
  role: "role",
} as const;

// A first suggestion built from the person's name ("Ama Mensah" →
// "ama_mensah"), so a Google sign-up arrives with every field filled
// in. Only a suggestion: it may already be taken, and the person can
// change it. Accents are dropped ("José" → "jose"); anything else that
// doesn't fit the username rules is removed. Returns "" when nothing
// usable is left, which just leaves the field empty.
function suggestUsername(firstName: string, lastName: string): string {
  const suggestion = [firstName, lastName]
    .map((part) =>
      part
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ""),
    )
    .filter(Boolean)
    .join("_")
    .replace(/^[^a-z]+/, "")
    .slice(0, 30);
  return USERNAME_PATTERN.test(suggestion) ? suggestion : "";
}

export function OnboardingForm({ account }: { account: OnboardingAccount }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const { asksRole, asksUsername } = account;
  const schema = useMemo(
    () => onboardingSchema({ role: asksRole, username: asksUsername }),
    [asksRole, asksUsername],
  );

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<OnboardingFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: account.firstName,
      lastName: account.lastName,
      username: asksUsername
        ? suggestUsername(account.firstName, account.lastName)
        : undefined,
    },
  });

  const showServerErrors = (body: Record<string, unknown>) => {
    let shownOnAField = false;
    for (const [serverName, formName] of Object.entries(SERVER_FIELDS)) {
      const messages = body[serverName];
      if (Array.isArray(messages) && messages.length > 0) {
        setError(formName, { message: String(messages[0]) });
        shownOnAField = true;
      }
    }
    if (!shownOnAField) {
      setFormError(
        typeof body.error === "string"
          ? body.error
          : "Could not finish setting up your account. Try again in a moment.",
      );
    }
  };

  const handleOnboard = async (data: OnboardingFormValues) => {
    setPending(true);
    setFormError(null);
    try {
      // authedFetch refreshes the 5-minute access token once if it ran
      // out while the person was filling the form in.
      const res = await authedFetch("/accounts/onboarding/", {
        method: "POST",
        json: {
          first_name: data.firstName,
          last_name: data.lastName,
          // Only what the account is still missing: the backend refuses
          // a username or role the account already has.
          ...(asksUsername ? { username: data.username } : {}),
          ...(asksRole ? { role: data.role } : {}),
        },
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        // The response is the updated user, so the cached identity (the
        // sidebar's role and username) is current before the dashboard
        // renders, with no extra /accounts/me/ request.
        queryClient.setQueryData(ME_QUERY_KEY, body);
        router.push("/dashboard");
        return;
      }
      showServerErrors(body as Record<string, unknown>);
    } catch {
      setFormError(
        "Could not reach the server — check your connection and try again.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-10 px-6 py-10">
      <Logo className="text-3xl" />

      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="mb-2 text-[28px] font-semibold text-[#111111]">
            Finish setting up
          </h1>
          <p className="text-muted-foreground text-sm">
            {asksUsername
              ? "Check your name and pick a username."
              : "Check your name before you carry on."}
          </p>
        </div>

        <form onSubmit={handleSubmit(handleOnboard)} className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1 space-y-2">
              <Label htmlFor="firstName" className="text-sm font-medium">
                First Name
              </Label>
              <Input
                id="firstName"
                type="text"
                autoComplete="given-name"
                aria-invalid={!!errors.firstName}
                {...register("firstName")}
              />
              {errors.firstName && (
                <p className="text-sm text-red-500">
                  {errors.firstName.message}
                </p>
              )}
            </div>
            <div className="flex-1 space-y-2">
              <Label htmlFor="lastName" className="text-sm font-medium">
                Last Name
              </Label>
              <Input
                id="lastName"
                type="text"
                autoComplete="family-name"
                aria-invalid={!!errors.lastName}
                {...register("lastName")}
              />
              {errors.lastName && (
                <p className="text-sm text-red-500">
                  {errors.lastName.message}
                </p>
              )}
            </div>
          </div>

          {asksUsername && (
            <div className="space-y-2">
              <Label htmlFor="username" className="text-sm font-medium">
                Username
              </Label>
              <Controller
                name="username"
                control={control}
                render={({ field }) => (
                  <Input
                    id="username"
                    type="text"
                    // "off", not "username": a password manager would
                    // otherwise drop the saved email in here.
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    aria-invalid={!!errors.username}
                    aria-describedby={errors.username ? "username-error" : "username-hint"}
                    {...field}
                    value={field.value ?? ""}
                    // Lowercased as you type: the backend only accepts
                    // lowercase, so "Ama" and "ama" can never be two
                    // different accounts.
                    onChange={(e) => field.onChange(e.target.value.toLowerCase())}
                  />
                )}
              />
              {errors.username ? (
                <p id="username-error" className="text-sm text-red-500">
                  {errors.username.message}
                </p>
              ) : (
                <p id="username-hint" className="text-muted-foreground text-xs">
                  Lowercase letters, numbers and underscores. It appears in
                  your dashboard links and can&apos;t be changed later.
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-medium">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              value={account.email}
              readOnly
              className="text-muted-foreground"
            />
          </div>

          {asksRole && (
            <div className="space-y-3 pt-2 text-center">
              <p className="text-sm font-medium text-[#111111]">
                How will you use paddy?
              </p>
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
              {errors.role ? (
                <p className="text-sm text-red-500">{errors.role.message}</p>
              ) : (
                <p className="text-muted-foreground text-xs">
                  This can&apos;t be changed later.
                </p>
              )}
            </div>
          )}

          {formError && <p className="text-sm text-red-500">{formError}</p>}

          <div className="pt-2">
            <PaddyButton
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              isLoading={pending}
            >
              Continue
            </PaddyButton>
          </div>
        </form>
      </div>
    </div>
  );
}

OnboardingForm.displayName = "OnboardingForm";
