"use client";

// The landlord-facing subscription surface — the minimal MVP piece AGENTS.md
// calls out as needed "sooner than post-MVP" now that subscriptions gate
// listing creation directly (free = 1 listing, so the SECOND create attempt
// otherwise hits a bare 403 toast with no upgrade path anywhere in the UI).
//
// Shows: current tier, listing usage against that tier's cap, period end for
// paid tiers, and an upgrade CTA per paid tier. Reads everything from
// GET /payments/subscription/ (backend/payments/views.py my_subscription)
// except the usage count, which comes from the listings the landlord already
// has (same count the backend's perform_create enforces the cap against —
// every listing regardless of status).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Crown, Loader2, Rocket } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  fetchMySubscription,
  startSubscriptionCheckout,
  TIER_META,
  type LandlordSubscription,
} from "@/lib/payments";

// TS strict-mode catch narrowing: thrown values are `unknown`, and the
// errors from lib/payments are plain `new Error(message)` — read `.message`
// through this guard rather than `any`-casting at every catch site.
function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "";
}

// Usage count is derived client-side from the landlord's own listings —
// deliberately NOT a separate backend field (mirrors AGENTS.md's
// "perks are derived from tier at read time" rule).
export function SubscriptionCard({
  userId,
  listingsUsed,
  refreshKey = 0,
}: {
  userId: string;
  listingsUsed: number;
  // Bump to refetch after an upgrade completes on the callback page
  refreshKey?: number;
}) {
  const router = useRouter();
  const [subscription, setSubscription] = useState<LandlordSubscription | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [upgradingTo, setUpgradingTo] = useState<string | null>(null);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  // NOTE: isLoading starts true and is only ever cleared (async, in the
  // fetch callbacks below) — never re-set synchronously inside the effect
  // (react-hooks/set-state-in-effect). On a refreshKey bump the card
  // silently refetches without the spinner, which is the nicer behavior
  // anyway (no flash of skeleton after a successful upgrade).
  useEffect(() => {
    let cancelled = false;
    fetchMySubscription()
      .then((sub) => {
        if (cancelled) return;
        setSubscription(sub);
        setLoadError(null);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorMessage(err) || "Couldn't load subscription.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // Callback URL back into THIS dashboard after Paystack checkout. Must be
  // absolute — Paystack redirects the browser there from their domain.
  function buildCallbackUrl(): string {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/payments/callback?purpose=subscription`;
  }

  async function handleUpgrade(tier: "agent" | "lord") {
    setUpgradingTo(tier);
    try {
      const init = await startSubscriptionCheckout({
        tier,
        callbackUrl: buildCallbackUrl(),
      });
      // Redirect to Paystack's hosted checkout — the simplest correct flow
      // (vs Paystack Inline popup, which would need their JS + access_code
      // handling; the authorization_url redirect needs neither). All
      // subscription/unlock checkout goes through the redirect shape.
      window.location.assign(init.authorization_url);
    } catch (err) {
      setUpgradingTo(null);
      // Surface the backend's actual reason (invalid tier, plan code not
      // configured in .env, Paystack rejected the init, etc.) inline,
      // matching how UnlockCta reports its own start-checkout failures.
      setUpgradeError(errorMessage(err));
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  if (loadError || !subscription) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-red-500">
          {loadError ?? "Couldn't load subscription."}
        </CardContent>
      </Card>
    );
  }

  const tierMeta = TIER_META[subscription.tier] ?? TIER_META.free;
  const cap = tierMeta.cap;
  const isPastDue = subscription.status === "past_due";
  // An active paid subscription = current tier perks apply. FREE tier rows
  // are never "active" per the backend model's own comment.
  const isPaidActive =
    subscription.status === "active" && subscription.tier !== "free";

  const usage =
    cap === null
      ? `${listingsUsed} listings`
      : `${listingsUsed} of ${cap} listing${cap === 1 ? "" : "s"}`;
  const usagePct =
    cap === null ? 0 : Math.min(100, Math.round((listingsUsed / cap) * 100));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Crown className="size-4" />
            Subscription
          </CardTitle>
          {isPastDue && <Badge variant="destructive">Past due</Badge>}
          {isPaidActive && <Badge>Active</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <p className="text-2xl font-bold leading-none">{tierMeta.label}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {tierMeta.priceGhs !== null
                ? `GHS ${tierMeta.priceGhs}/mo`
                : "Default tier"}
            </p>
          </div>
          <p className="text-muted-foreground text-xs">
            {usage}
            {cap !== null && listingsUsed >= cap && (
              <span className="text-destructive ml-1 font-medium">
                — limit reached
              </span>
            )}
          </p>
        </div>

        {/* Simple usage bar — deliberately plain (skeleton-first philosophy) */}
        {cap !== null && (
          <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-all"
              style={{ width: `${usagePct}%` }}
            />
          </div>
        )}

        {isPaidActive && subscription.current_period_end && (
          <p className="text-muted-foreground text-xs">
            Renews/period ends{" "}
            {new Date(subscription.current_period_end).toLocaleDateString()}
          </p>
        )}

        {isPastDue && (
          <p className="text-destructive text-xs">
            Your last renewal failed — renew to restore your tier&apos;s listing
            cap and unlock perks.
          </p>
        )}

        {/* Upgrade CTA — the next tier up from the current one. From free
            that's agent; from agent that's lord; from lord there's nothing. */}
        {!isPaidActive && (
          <div className="flex flex-col gap-2 border-t pt-3">
            {upgradeError && (
              <p className="text-destructive text-xs">{upgradeError}</p>
            )}
            {subscription.tier === "free" && (
              <>
                <UpgradeRow
                  tier="agent"
                  busy={upgradingTo === "agent"}
                  onUpgrade={handleUpgrade}
                />
                <UpgradeRow
                  tier="lord"
                  busy={upgradingTo === "lord"}
                  onUpgrade={handleUpgrade}
                />
              </>
            )}
            {subscription.tier === "agent" && (
              <UpgradeRow
                tier="lord"
                busy={upgradingTo === "lord"}
                onUpgrade={handleUpgrade}
              />
            )}
          </div>
        )}
        {subscription.tier === "lord" && isPaidActive && (
          <p className="text-muted-foreground border-t pt-3 text-xs">
            Top tier — unlimited listings, every perk unlocked.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function UpgradeRow({
  tier,
  busy,
  onUpgrade,
}: {
  tier: "agent" | "lord";
  busy: boolean;
  onUpgrade: (tier: "agent" | "lord") => void;
}) {
  const meta = TIER_META[tier];
  return (
    <Button
      type="button"
      variant={tier === "lord" ? "default" : "outline"}
      className="justify-between"
      disabled={busy}
      onClick={() => onUpgrade(tier)}
    >
      <span className="flex items-center gap-2">
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Rocket className="size-4" />
        )}
        Upgrade to {meta.label}
      </span>
      <span className="text-xs">
        GHS {meta.priceGhs}/mo · {meta.cap === null ? "unlimited" : meta.cap}{" "}
        listings
      </span>
    </Button>
  );
}
