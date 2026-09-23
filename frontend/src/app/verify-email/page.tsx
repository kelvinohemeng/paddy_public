"use client";

// Email verification landing page — the target of the verification
// link the backend emails at signup (see send_verification_email in
// backend/accounts/views.py). The frontend verifies NOTHING itself;
// it reads uid + token out of the URL and forwards them, then renders
// whatever the backend decides.
//
// Contract (backend/accounts/urls.py + views.py verify_email):
//   POST /accounts/verify-email/   {uid, token}   (public, no auth)
//   - 200 {'message': 'Email verified successfully'}
//   - 400 {'error': 'Invalid link'} (bad uid / unknown user)
//   - 400 {'error': 'Invalid or expired token'}
//
// NOTE: the emailed link currently hardcodes http://localhost:3000
// (backend concern — it must become env-driven before production or
// every production signup email points at localhost). This page works
// under any origin; only the emailed URL is wrong.

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, CircleCheck, CircleX } from "lucide-react";

import { Button } from "@/components/ui/button";

type VerifyState =
  | { phase: "missing" }
  | { phase: "verifying" }
  | { phase: "success"; message: string }
  | { phase: "error"; message: string };

function VerifyEmailInner() {
  const searchParams = useSearchParams();
  const [state, setState] = useState<VerifyState>({ phase: "verifying" });

  useEffect(() => {
    const uid = searchParams.get("uid");
    const token = searchParams.get("token");

    if (!uid || !token) {
      setState({ phase: "missing" });
      return;
    }

    let cancelled = false;

    async function verify() {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/accounts/verify-email/`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid, token }),
          },
        );
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) {
          setState({
            phase: "success",
            message:
              (body as { message?: string }).message ??
              "Email verified successfully",
          });
        } else {
          setState({
            phase: "error",
            message:
              (body as { error?: string }).error ??
              "This verification link is invalid or has expired.",
          });
        }
      } catch {
        if (!cancelled) {
          setState({
            phase: "error",
            message:
              "Could not reach the server — check your connection and try again.",
          });
        }
      }
    }

    verify();
    return () => {
      cancelled = true;
    };
    // Run once per distinct link — searchParams identity is stable for
    // a given URL, and re-running on unrelated renders would double-POST
    // (harmless server-side: tokens are single-use-checked, but the
    // second response would read "expired" and flash an error).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      {state.phase === "verifying" && (
        <>
          <Loader2 className="size-8 animate-spin" />
          <p className="text-muted-foreground text-sm">
            Verifying your email...
          </p>
        </>
      )}

      {state.phase === "missing" && (
        <>
          <CircleX className="size-8 text-red-500" />
          <h1 className="text-xl font-bold">Invalid verification link</h1>
          <p className="text-muted-foreground text-sm">
            This link is missing its verification details. Please use the
            full link from your signup email.
          </p>
          <Link href="/login">
            <Button>Back to login</Button>
          </Link>
        </>
      )}

      {state.phase === "success" && (
        <>
          <CircleCheck className="size-8 text-green-600" />
          <h1 className="text-xl font-bold">Email verified</h1>
          <p className="text-muted-foreground text-sm">{state.message}</p>
          <Link href="/login">
            <Button>Sign in</Button>
          </Link>
        </>
      )}

      {state.phase === "error" && (
        <>
          <CircleX className="size-8 text-red-500" />
          <h1 className="text-xl font-bold">Verification failed</h1>
          <p className="text-muted-foreground text-sm">{state.message}</p>
          <Link href="/login">
            <Button variant="outline">Back to login</Button>
          </Link>
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  // useSearchParams requires a Suspense boundary (Next.js prerenders
  // this route without query values; without the boundary the build
  // fails outright).
  return (
    <Suspense
      fallback={
        <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
          <Loader2 className="size-8 animate-spin" />
          <p className="text-muted-foreground text-sm">
            Verifying your email...
          </p>
        </div>
      }
    >
      <VerifyEmailInner />
    </Suspense>
  );
}
