import { Suspense } from "react";
import { PaymentCallbackClient } from "./callback-client";

// Full-page fallback for /payments/callback — the URL Paystack redirects
// back to after hosted checkout (subscription upgrades AND listing unlocks
// both land here, discriminated by ?purpose= which the client also relies
// on when Paystack redirects with only its own ?reference= attached).
//
// Reached by a hard browser navigation from Paystack's domain, so this
// ordinary page (not an intercepted modal) is what actually renders.
// Suspense is required around useSearchParams in the App Router.

export default function PaymentCallbackPage() {
  return (
    <Suspense>
      <PaymentCallbackClient />
    </Suspense>
  );
}
