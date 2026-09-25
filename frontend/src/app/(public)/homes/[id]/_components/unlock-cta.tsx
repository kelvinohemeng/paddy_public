"use client";

import { useState } from "react";
import { startUnlockCheckout } from "@/lib/payments";

// TS strict-mode catch narrowing — same guard as subscription-card.tsx.
function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Could not start checkout — please try again.";
}

// Pay-to-unlock checkout, extracted from the old <UnlockCta> card so
// the Figma booking card's primary button can drive it. Logic is
// unchanged from that component.
//
// Reflects the REAL backend contract, not a guess: unlocking a
// listing (POST /payments/unlock-listing/, see backend/payments/
// views.py's initiate_listing_unlock) requires IsAuthenticated — ANY
// logged-in user, no role check, since ListingSerializer._has_access
// already decided who genuinely needs to pay. The PRICE is never sent
// from here — the backend charges settings.LISTING_UNLOCK_PRICE_PESEWAS.
//
// Checkout flow (AGENTS.md build-priority #3):
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
export function useUnlockCheckout(listingId: string | number) {
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  async function startUnlock() {
    setStarting(true);
    setStartError(null);
    try {
      // Stash BEFORE the redirect — Paystack's callback will only carry
      // ?reference= (and whatever we baked into the callback path).
      sessionStorage.setItem("paddy_unlock_listing_id", window.location.pathname);

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

  return { starting, startError, startUnlock };
}
