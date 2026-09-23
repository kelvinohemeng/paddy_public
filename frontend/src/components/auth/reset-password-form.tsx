"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { CircleCheck, CircleX, Loader2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PaddyButton } from "@/components/paddy-button";
import { InputPassword } from "@/components/auth/input-password";
import { Logo } from "@/components/logo";
import {
  ResetPasswordFormValues,
  resetPasswordSchema,
  ConfirmResetPasswordFormValues,
  confirmResetPasswordSchema,
} from "@schemas/auth.schema";

// Spec: Figma "Auth" section → Reset Password (relay 174:20009).
// Centered single column (NOT the split panel — see
// auth-split-layout.tsx's own note), small illustration accent, logo
// above.
//
// Two modes, one route (/reset-password), same as verify-email's
// pattern (uid+token in the URL decide the mode):
//   REQUEST mode — no ?uid&?token in the URL. Figma's designed form:
//     Email only, "Send Reset Email" button.
//   CONFIRM mode — the backend-emailed link:
//     http://localhost:3000/reset-password?uid=<uid>&token=<token>
//     (confirmed by Kelvin from the backend agent, 2026-09-23).
//     Shows New Password + Confirm Password instead — Figma has no
//     frame for this second step, so it borrows Signup's password
//     field pattern for visual consistency.
//
// BACKEND CONFIRMED 2026-09-23 (paddy backend agent handoff):
//   REQUEST: POST /accounts/password-reset/          {email}
//     -> always 200 {message}, never leaks account existence
//   CONFIRM: POST /accounts/password-reset/confirm/   {uid, token, new_password}
//     -> 200 {message} | 400 {error: string} | 400 {error: string[]}
//        (string[] is Django's AUTH_PASSWORD_VALIDATORS messages —
//        NOT the same "1 upper/1 number/1 special" rule signup's
//        zod schema checks client-side; that's a pre-existing
//        client/server rule mismatch per the backend agent, not
//        something introduced here)
// Token is single-use + expires (Django default PASSWORD_RESET_TIMEOUT,
// 3 days). On success every refresh token for that user is
// blacklisted server-side (all sessions logged out) — no frontend
// action needed for that part.

export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const uid = searchParams.get("uid");
  const token = searchParams.get("token");
  const isConfirmMode = Boolean(uid && token);

  return isConfirmMode ? (
    <ConfirmResetPassword uid={uid!} token={token!} />
  ) : (
    <RequestResetPassword />
  );
}

function RequestResetPassword() {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const {
    register: registerField,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { email: "" },
  });

  const handleReset = async (data: ResetPasswordFormValues) => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/accounts/password-reset/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: data.email }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ??
            "Could not send the reset email. Try again in a moment.",
        );
      }
      setSubmitted(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not reach the server — check your connection and try again.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthCenteredShell>
      {submitted ? (
        <div className="space-y-3 text-center">
          <CircleCheck className="mx-auto size-8 text-green-600" aria-hidden />
          <h1 className="text-2xl font-semibold text-[#111111]">
            Check your email
          </h1>
          <p className="text-muted-foreground text-sm">
            If an account exists for that email, a reset link is on its way.
          </p>
          <Link href="/login" className="text-sm font-medium underline">
            Back to login
          </Link>
        </div>
      ) : (
        <>
          <h1 className="mb-6 text-[28px] font-semibold text-[#111111]">
            Reset Password
          </h1>

          <form onSubmit={handleSubmit(handleReset)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">
                Email
              </Label>
              <Input {...registerField("email")} id="email" type="email" />
              {errors.email && (
                <p className="text-sm text-red-500">{errors.email.message}</p>
              )}
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <PaddyButton
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              isLoading={pending}
            >
              Send Reset Email
            </PaddyButton>
          </form>

          <p className="mt-6 text-center text-sm">
            <Link href="/login" className="font-semibold text-[#17171C] underline">
              Back to login
            </Link>
          </p>
        </>
      )}
    </AuthCenteredShell>
  );
}

function ConfirmResetPassword({ uid, token }: { uid: string; token: string }) {
  const [phase, setPhase] = useState<"form" | "success" | "invalid">("form");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const {
    register: registerField,
    handleSubmit,
    formState: { errors },
  } = useForm<ConfirmResetPasswordFormValues>({
    resolver: zodResolver(confirmResetPasswordSchema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  const handleConfirm = async (data: ConfirmResetPasswordFormValues) => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/accounts/password-reset/confirm/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uid,
            token,
            new_password: data.newPassword,
          }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setPhase("success");
      } else {
        // error is either a string ({error: "Invalid link"}) or an
        // array of AUTH_PASSWORD_VALIDATORS messages
        // ({error: ["This password is too common.", ...]}).
        const raw = (body as { error?: string | string[] }).error;
        setError(
          Array.isArray(raw)
            ? raw.join(" ")
            : raw ?? "This reset link is invalid or has expired.",
        );
        setPhase("invalid");
      }
    } catch {
      setError(
        "Could not reach the server — check your connection and try again.",
      );
      setPhase("invalid");
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthCenteredShell>
      {phase === "success" ? (
        <div className="space-y-3 text-center">
          <CircleCheck className="mx-auto size-8 text-green-600" aria-hidden />
          <h1 className="text-2xl font-semibold text-[#111111]">
            Password reset
          </h1>
          <p className="text-muted-foreground text-sm">
            Your password has been updated. Sign in with your new password.
          </p>
          <Link href="/login" className="text-sm font-medium underline">
            Back to login
          </Link>
        </div>
      ) : (
        <>
          <h1 className="mb-6 text-[28px] font-semibold text-[#111111]">
            Set a new password
          </h1>

          <form onSubmit={handleSubmit(handleConfirm)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword" className="text-sm font-medium">
                New Password
              </Label>
              <InputPassword
                {...registerField("newPassword")}
                id="newPassword"
              />
              {errors.newPassword && (
                <p className="text-sm text-red-500">
                  {errors.newPassword.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-sm font-medium">
                Confirm Password
              </Label>
              <InputPassword
                {...registerField("confirmPassword")}
                id="confirmPassword"
              />
              {errors.confirmPassword && (
                <p className="text-sm text-red-500">
                  {errors.confirmPassword.message}
                </p>
              )}
            </div>

            {phase === "invalid" && error && (
              <div className="flex items-start gap-2 text-sm text-red-500">
                <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{error}</span>
              </div>
            )}

            <PaddyButton
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              isLoading={pending}
            >
              Update Password
            </PaddyButton>
          </form>

          <p className="mt-6 text-center text-sm">
            <Link href="/reset-password" className="font-medium underline">
              Request a new link
            </Link>
            {" · "}
            <Link href="/login" className="font-semibold text-[#17171C] underline">
              Back to login
            </Link>
          </p>
        </>
      )}
    </AuthCenteredShell>
  );
}

function AuthCenteredShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-10 px-6 py-10">
      <Logo className="text-3xl" />
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

ResetPasswordForm.displayName = "ResetPasswordForm";
