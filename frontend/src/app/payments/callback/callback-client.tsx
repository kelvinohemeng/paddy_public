"use client";

// THE page Paystack redirects the browser back to after hosted checkout —
// for BOTH payment types (subscription upgrade and listing unlock),
// discriminated by the ?purpose= query param that startSubscriptionCheckout
// / startUnlockCheckout baked into their callback_url.
//
// Why a callback page instead of Paystack Inline popup: the backend returns
// authorization_url from both initiate endpoints, and a redirect flow needs
// no Paystack JS, no popup blockers, works identically on mobile money and
// card, and lands on a URL we control where we can call
// GET /payments/verify/?reference=... — the synchronous half of payment
// confirmation (see verify_payment in payments/views.py). The webhook stays
// the source of truth; verify just makes the success visible immediately
// instead of "reload and hope the webhook landed".
//
// NOTE for unlock purpose: the caller (UnlockCta) stores the listing id in
// sessionStorage before redirecting, because Paystack strips everything
// except its own query params off the callback URL — we cannot round-trip
// the listing id through Paystack's redirect. The id ALSO lives in the
// charge's server-side metadata (set by initiate_listing_unlock), so this
// is purely a routing convenience, never a security decision.

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { verifyPayment } from "@/lib/payments";

type Phase = "verifying" | "success" | "failed";

export function PaymentCallbackClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reference = searchParams.get("reference");
  const purpose = searchParams.get("purpose") ?? "subscription";

  const [phase, setPhase] = useState<Phase>("verifying");
  const [detail, setDetail] = useState<string>("");
  const verifyRanRef = useRef(false);
  // useSearchParams in a client component can re-run effects under
  // Suspense re-renders; verify is a real Paystack API call, so it must
  // run exactly ONCE per landing — a ref guard is the cheap, correct way.

  useEffect(() => {
    if (verifyRanRef.current || !reference) return;
    verifyRanRef.current = true;

    verifyPayment(reference)
      .then((result) => {
        if (result.verified) {
          setPhase("success");
          setDetail(
            purpose === "unlock"
              ? "Listing unlocked — the exact address and landlord contact are now visible."
              : "Subscription activated — your new listing cap is live.",
          );
        } else {
          // Paystack reports the charge itself as not-success
          // ('abandoned'/'failed'/'pending')
          setPhase("failed");
          setDetail(
            `Payment not completed${result.status ? ` (status: ${result.status})` : ""}. No charge was confirmed — you have not been billed.`,
          );
        }
      })
      .catch((err) => {
        setPhase("failed");
        setDetail(err?.message ?? "Could not verify the payment.");
      });
  }, [reference, purpose]);

  // Where "done" goes, per purpose:
  function handleDone() {
    if (purpose === "unlock") {
      const listingId = sessionStorage.getItem("paddy_unlock_listing_id");
      sessionStorage.removeItem("paddy_unlock_listing_id");
      if (listingId) {
        // Fresh full-page load of the detail page — its server fetch now
        // runs WITH the user's token (see homes/[id]/page.tsx) so the
        // unlocked address/contact render server-side immediately.
        router.push(`/homes/${listingId}`);
        return;
      }
      router.push("/");
      return;
    }
    // Subscription: land back on /dashboard — the server-redirect there
    // resolves the session's user id and forwards to their listings page
    // (see (admin)/dashboard/page.tsx), where SubscriptionCard refetches
    // fresh tier/cap state on mount. No need to round-trip the user id
    // through storage: /dashboard already does that resolution.
    router.push("/dashboard");
  }

  // No reference in the URL at all (someone browsing here directly, or a
  // malformed callback) — DERIVED state, not effect-set: rendering this
  // branch synchronously avoids setState-in-effect entirely and honestly
  // reports that verification never ran.
  if (!reference) {
    return (
      <Shell>
        <XCircle className="text-destructive mx-auto size-10" />
        <h1 className="text-lg font-semibold">Payment not confirmed</h1>
        <p className="text-muted-foreground text-sm">
          No payment reference found in the callback URL.
        </p>
        <Button type="button" className="w-full" onClick={handleDone}>
          {purpose === "unlock" ? "Back to listing" : "Back to dashboard"}
        </Button>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="w-full max-w-md space-y-4 rounded-lg border p-8 text-center">
        {phase === "verifying" && (
          <>
            <Loader2 className="mx-auto size-10 animate-spin text-muted-foreground" />
            <h1 className="text-lg font-semibold">Confirming your payment…</h1>
            <p className="text-muted-foreground text-sm">
              Checking with Paystack — don&apos;t close this page.
            </p>
          </>
        )}

        {phase === "success" && (
          <>
            <CheckCircle2 className="mx-auto size-10 text-green-600" />
            <h1 className="text-lg font-semibold">Payment confirmed</h1>
            <p className="text-muted-foreground text-sm">{detail}</p>
          </>
        )}

        {phase === "failed" && (
          <>
            <XCircle className="text-destructive mx-auto size-10" />
            <h1 className="text-lg font-semibold">Payment not confirmed</h1>
            <p className="text-muted-foreground text-sm">{detail}</p>
            <p className="text-muted-foreground text-xs">
              If you were charged but see this, the webhook may still be
              processing — wait a minute and reload the page you started from.
            </p>
          </>
        )}

        {phase !== "verifying" && (
          <Button type="button" className="w-full" onClick={handleDone}>
            {purpose === "unlock" ? "Back to listing" : "Back to dashboard"}
          </Button>
        )}
      </div>
    </Shell>
  );
}

// The centered card both render branches share — extracting it keeps the
// derived no-reference branch and the post-verify branches visually
// identical without duplicating the wrapper classes.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 rounded-lg border p-8 text-center">
        {children}
      </div>
    </div>
  );
}
