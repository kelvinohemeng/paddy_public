"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LockKeyhole, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startUnlockCheckout } from "@/lib/payments";

// TS strict-mode catch narrowing — same guard as subscription-card.tsx.
function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Could not start checkout — please try again.";
}

// Reflects the REAL backend contract, not a guess: unlocking a
// listing (POST /payments/unlock-listing/, see backend/payments/
// views.py's initiate_listing_unlock) requires IsAuthenticated — ANY
// logged-in user, no role check, since ListingSerializer._has_access
// already decided who genuinely needs to pay.
//
// Checkout flow (AGENTS.md build-priority #3, now actually wired):
//   1. POST /payments/unlock-listing/ with this listing's id + a callback
//      URL pointing at /payments/callback?purpose=unlock
//   2. sessionStorage stashes the listing id FIRST — Paystack strips all
//      but its own query params off the callback URL, so the id can't be
//      round-tripped through the redirect itself
//   3. browser redirects to Paystack's hosted checkout (authorization_url)
//   4. Paystack redirects back → callback page calls
//      GET /payments/verify/?reference=... → routes back to this listing,
//      now server-rendered WITH the user's token so the unlocked
//      address/contact are visible immediately

export function UnlockCta({
  isUnlocked,
  isAuthenticated,
  listingId,
}: {
  isUnlocked: boolean;
  isAuthenticated: boolean;
  listingId: string | number;
  // listingId arrives from the server component (homes/[id]/page.tsx) —
  // it's the same id the URL already carries, passed down so this
  // component stays presentational about WHERE it lives.
}) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  if (isUnlocked) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-green-600/30 bg-green-600/10 p-3 text-sm text-green-700">
        <Unlock className="size-4 shrink-0" />
        Address and landlord contact unlocked.
      </div>
    );
  }

  async function handleUnlock() {
    setStarting(true);
    setStartError(null);
    try {
      // Stash BEFORE the redirect — Paystack's callback will only carry
      // ?reference= (and whatever we baked into the callback path).
      sessionStorage.setItem("paddy_unlock_listing_id", String(listingId));

      const init = await startUnlockCheckout({
        listingId,
        callbackUrl: `${window.location.origin}/payments/callback?purpose=unlock`,
      });
      // Full-page redirect to Paystack's hosted checkout. Deliberate
      // location.assign (not router.push) — we're LEAVING the app for
      // Paystack's domain, and the return leg is a fresh hard load of
      // the callback page anyway.
      window.location.assign(init.authorization_url);
    } catch (err) {
      sessionStorage.removeItem("paddy_unlock_listing_id");
      setStarting(false);
      // Backend reasons include "You have already unlocked this listing"
      // (race with the server's unlock state) and Paystack init failures.
      setStartError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-2 rounded-md border p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <LockKeyhole className="size-4 shrink-0" />
        Exact address & landlord contact are locked
      </div>
      <p className="text-muted-foreground text-xs">
        Pay a one-time fee to unlock this listing&apos;s precise location and
        the landlord&apos;s direct contact details.
      </p>
      {isAuthenticated ? (
        <>
          <Button
            type="button"
            className="w-full"
            onClick={handleUnlock}
            disabled={starting}
          >
            {starting && <Loader2 className="size-4 animate-spin" />}
            {starting ? "Starting checkout…" : "Unlock contact details"}
          </Button>
          {startError && (
            <p className="text-destructive text-xs">{startError}</p>
          )}
        </>
      ) : (
        <Button
          type="button"
          className="w-full"
          onClick={() => router.push("/login")}
          // NOT a redirect-back-here-after-login flow — the existing
          // auth stack (authProviderClient.login) hardcodes
          // redirectTo: "/dashboard" and neither SignInForm nor
          // login/page.tsx read any redirect query param today. Wiring
          // "return to this listing after signing in" is real,
          // separate work across the auth provider + sign-in form,
          // not something to fake here with a param nothing reads.
        >
          Sign in to unlock
        </Button>
      )}
    </div>
  );
}
