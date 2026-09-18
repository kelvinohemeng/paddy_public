"use client";

import { useRouter } from "next/navigation";
import { LockKeyhole, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";

// Reflects the REAL backend contract, not a guess: unlocking a
// listing (POST /payments/unlock-listing/, see backend/payments/
// views.py's initiate_listing_unlock) requires IsAuthenticated — ANY
// logged-in user, no role check, since ListingSerializer._has_access
// already decided who genuinely needs to pay. So an anonymous visitor
// literally cannot unlock anything yet; sending them to /login is the
// only honest CTA state until the actual Paystack checkout flow
// (priority #3, a separate, higher-review-bar build per AGENTS.md's
// payments note) exists.
//
// isUnlocked/isAuthenticated are passed in as server-known booleans
// (see page.tsx) rather than re-derived client-side — this component
// stays a thin, stateless presentational piece.

export function UnlockCta({
  isUnlocked,
  isAuthenticated,
}: {
  isUnlocked: boolean;
  isAuthenticated: boolean;
}) {
  const router = useRouter();

  if (isUnlocked) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-green-600/30 bg-green-600/10 p-3 text-sm text-green-700 dark:text-green-400">
        <Unlock className="size-4 shrink-0" />
        Address and landlord contact unlocked.
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <LockKeyhole className="size-4 shrink-0" />
        Exact address & landlord contact are locked
      </div>
      <p className="text-muted-foreground text-xs">
        Pay a one-time fee to unlock this listing's precise location and
        the landlord's direct contact details.
      </p>
      {isAuthenticated ? (
        <Button type="button" className="w-full" disabled>
          Unlock — checkout coming soon
          {/* Real Paystack Inline checkout (priority #3) isn't wired
              up yet — this button correctly reflects "you CAN unlock,
              once checkout exists" rather than pretending to work. */}
        </Button>
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
