"use client";

// The landlord-facing subscription surface — the minimal MVP piece AGENTS.md
// calls out as needed "sooner than post-MVP" now that plans gate how many
// listings can be live.
//
// Every number here comes from GET /payments/subscription/ (backend
// payments/views.py my_subscription + payments/limits.py usage_for) — the
// SAME code that enforces the limits. The card never counts listings
// itself: that's how the old card came to say "3 of 1 — limit reached"
// while the backend (which counts only live listings) disagreed.
//
// Shows:
// - the plan whose limits apply now (effective_tier), and the stored tier
//   as "ended" when a paid plan has lapsed (tier !== effective_tier);
// - live listings used against the live limit (published + in review);
// - paused listings ("N paused — upgrade to bring them back");
// - on Free, the 10-listing total ("X of 10 listings");
// - renewal / cancelled / past-due dates;
// - upgrade or switch buttons for every paid plan the landlord isn't on,
//   and Cancel plan (with a confirm dialog) on a paid plan.
//
// Split in two: SubscriptionCard fetches and runs the actions;
// SubscriptionCardView only draws, so Storybook can show every state.

import { useState } from "react";
import { Crown, Loader2, Rocket } from "lucide-react";

import { PaddyBadge, type PaddyBadgeState } from "@/components/paddy-badge";
import { PaddyButton } from "@/components/paddy-button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useApiInvalidate } from "@/hooks/use-api";
import { useMySubscription, useSetMySubscription } from "@/hooks/use-subscription";
import {
  cancelSubscription,
  PaymentsError,
  startSubscriptionCheckout,
  TIER_META,
  type LandlordSubscription,
  type SubscriptionTier,
} from "@/lib/payments";
import { cn } from "@/lib/utils";

type PaidTier = Exclude<SubscriptionTier, "free">;
const PAID_TIERS: PaidTier[] = ["agent", "lord"];

// Friendly text for the backend's machine-readable codes — never a raw
// error. Anything uncoded falls back to the backend's own message, which
// is already written for people.
function checkoutErrorText(err: unknown): string {
  if (err instanceof PaymentsError) {
    switch (err.code) {
      case "already_on_plan":
        return "You're already on that plan.";
      case "plan_change_pending":
        return "Your last plan change is still being finalised. Please try again in a few minutes.";
      case "email_not_verified":
        return "Verify your email before upgrading — the banner at the top of the page can resend the link.";
    }
    return err.message;
  }
  return "Couldn't start the upgrade. Please try again.";
}

function cancelErrorText(err: unknown): string {
  if (err instanceof PaymentsError) {
    if (err.status === 502) {
      return "We couldn't reach Paystack, so nothing has changed. Please try again.";
    }
    switch (err.code) {
      case "already_cancelled":
        return "Your plan is already cancelled.";
      case "no_paid_plan":
        return "You're not on a paid plan, so there's nothing to cancel.";
    }
    return err.message;
  }
  return "Couldn't cancel your plan. Please try again.";
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function SubscriptionCard({ className }: { className?: string }) {
  const { data: subscription, isLoading, error, refetch } = useMySubscription();
  const setSubscription = useSetMySubscription();
  const invalidate = useApiInvalidate();

  const [upgradingTo, setUpgradingTo] = useState<PaidTier | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Callback URL back into the dashboard after Paystack checkout. Must be
  // absolute — Paystack redirects the browser there from their domain.
  function buildCallbackUrl(): string {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/payments/callback?purpose=subscription`;
  }

  async function handleUpgrade(tier: PaidTier) {
    setUpgradingTo(tier);
    setActionError(null);
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
      setActionError(checkoutErrorText(err));
    }
  }

  // Resolves true when the plan was cancelled, so the dialog knows to
  // close; on failure it stays open with the reason inside it.
  async function handleCancel(): Promise<boolean> {
    setCancelling(true);
    setActionError(null);
    try {
      // The endpoint returns the updated subscription — put it straight
      // into the cache instead of refetching.
      setSubscription(await cancelSubscription());
      return true;
    } catch (err) {
      setActionError(cancelErrorText(err));
      // no_paid_plan / already_cancelled mean our copy is out of date.
      if (err instanceof PaymentsError && err.status === 400) {
        void invalidate("payments");
      }
      return false;
    } finally {
      setCancelling(false);
    }
  }

  if (isLoading) {
    return (
      <div
        className={cn(
          "border-hairline flex items-center justify-center rounded-lg border bg-white py-10",
          className,
        )}
      >
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    );
  }

  if (error || !subscription) {
    return (
      <div
        className={cn(
          "border-hairline flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-5 text-sm",
          className,
        )}
      >
        <p className="text-destructive">Couldn&apos;t load your plan.</p>
        <PaddyButton size="sm" variant="secondary" onClick={() => void refetch()}>
          Try again
        </PaddyButton>
      </div>
    );
  }

  return (
    <SubscriptionCardView
      subscription={subscription}
      className={className}
      upgradingTo={upgradingTo}
      cancelling={cancelling}
      actionError={actionError}
      onUpgrade={handleUpgrade}
      onCancel={handleCancel}
      onDismissError={() => setActionError(null)}
    />
  );
}

export function SubscriptionCardView({
  subscription,
  className,
  upgradingTo = null,
  cancelling = false,
  actionError = null,
  onUpgrade,
  onCancel,
  onDismissError,
}: {
  subscription: LandlordSubscription;
  className?: string;
  upgradingTo?: PaidTier | null;
  cancelling?: boolean;
  actionError?: string | null;
  onUpgrade?: (tier: PaidTier) => void;
  onCancel?: () => Promise<boolean>;
  onDismissError?: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const effective = subscription.effective_tier;
  const effectiveMeta = TIER_META[effective];
  const isPaid = effective !== "free";
  // A paid plan that ran out: the stored tier still names it, but Free's
  // limits apply now.
  const lapsed = subscription.tier !== "free" && subscription.tier !== effective;
  const cancelled = isPaid && subscription.cancel_at_period_end;
  const pastDue = isPaid && subscription.status === "past_due";

  const badge: { label: string; state: PaddyBadgeState } | null = lapsed
    ? { label: "Ended", state: "neutral" }
    : cancelled
      ? { label: "Cancelled", state: "warning" }
      : pastDue
        ? { label: "Past due", state: "error" }
        : isPaid
          ? { label: "Active", state: "success" }
          : null;

  const cap = subscription.listing_cap;
  const used = subscription.listings_used;
  const atCap = cap !== null && used >= cap;
  const usagePct = cap === null || cap === 0 ? 0 : Math.min(100, Math.round((used / cap) * 100));

  const totalCap = subscription.listing_total_cap;
  const total = subscription.listings_total;
  const atTotalCap = totalCap !== null && total !== null && total >= totalCap;

  const paused = subscription.listings_paused;

  // Every paid plan except the one whose limits apply now: re-buying that
  // one is refused by the backend (already_on_plan), and a cancelled plan
  // can't be resumed yet — once it runs out, buying it again works.
  const offers = PAID_TIERS.filter((t) => t !== effective);

  return (
    <section
      aria-labelledby="subscription-title"
      className={cn("border-hairline rounded-lg border bg-white p-5", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id="subscription-title"
          className="text-subtle-foreground flex items-center gap-2 text-[13px] leading-5 font-medium"
        >
          <Crown className="size-4" aria-hidden />
          Your plan
        </h2>
        {badge && <PaddyBadge state={badge.state}>{badge.label}</PaddyBadge>}
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-[22px] leading-tight font-medium tracking-[-0.02em] text-black/80">
            {effectiveMeta.label}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {effectiveMeta.priceGhs !== null
              ? `GHS ${effectiveMeta.priceGhs.toLocaleString()}/mo`
              : "No monthly fee"}
          </p>
        </div>
        <p className="text-muted-foreground shrink-0 text-right text-xs">
          <span className="text-foreground font-medium">
            {cap === null ? `${used} live` : `${used} of ${cap} live`}
          </span>
          {cap === null ? " · unlimited" : ` listing${cap === 1 ? "" : "s"}`}
          {atCap && <span className="text-destructive block font-medium">Limit reached</span>}
        </p>
      </div>

      {cap !== null && (
        <div
          className="bg-muted mt-3 h-1.5 w-full overflow-hidden rounded-full"
          role="progressbar"
          aria-label="Live listings used"
          aria-valuenow={used}
          aria-valuemin={0}
          aria-valuemax={cap}
        >
          <div
            className={cn(
              "h-full rounded-full transition-all",
              atCap ? "bg-destructive" : "bg-primary",
            )}
            style={{ width: `${usagePct}%` }}
          />
        </div>
      )}
      <p className="text-muted-foreground mt-2 text-xs">
        Live = published or in review. Drafts don&apos;t count until you submit them.
      </p>

      <ul className="mt-3 space-y-1.5 text-xs">
        {lapsed && (
          <li className="text-foreground">
            Your {TIER_META[subscription.tier].label} plan has ended — Free limits apply now.
          </li>
        )}
        {paused > 0 && (
          <li className="text-foreground">
            <span className="font-medium">
              {paused} listing{paused === 1 ? "" : "s"} paused
            </span>{" "}
            — upgrade to bring {paused === 1 ? "it" : "them"} back. Paused listings
            return on their own once you pay.
          </li>
        )}
        {totalCap !== null && total !== null && (
          <li className={atTotalCap ? "text-destructive font-medium" : "text-muted-foreground"}>
            {total} of {totalCap} listings on the Free plan
            {atTotalCap
              ? " — archive one or upgrade to create more."
              : " (archived and leased ones don't count)."}
          </li>
        )}
        {isPaid && !cancelled && !pastDue && subscription.current_period_end && (
          <li className="text-muted-foreground">
            Renews on {formatDate(subscription.current_period_end)}.
          </li>
        )}
        {cancelled && (
          <li className="text-foreground">
            Cancelled — your plan ends on {formatDate(subscription.paid_access_ends_at)}.
          </li>
        )}
        {pastDue && !cancelled && (
          <li className="text-destructive">
            Your last renewal failed. Paystack is retrying the card; your plan
            stays active until {formatDate(subscription.paid_access_ends_at)}.
          </li>
        )}
      </ul>

      {actionError && (
        <p role="alert" className="text-destructive mt-3 text-xs">
          {actionError}
        </p>
      )}

      {(offers.length > 0 || (isPaid && !cancelled)) && (
        <div className="border-hairline mt-4 flex flex-col gap-2 border-t pt-4">
          {offers.map((tier) => (
            <UpgradeRow
              key={tier}
              tier={tier}
              // Lord → agent is a switch down, anything else an upgrade.
              verb={effective === "lord" ? "Switch to" : "Upgrade to"}
              busy={upgradingTo === tier}
              disabled={upgradingTo !== null && upgradingTo !== tier}
              onUpgrade={(t) => onUpgrade?.(t)}
            />
          ))}
          {effective === "lord" && (
            <p className="text-muted-foreground text-xs">
              Switching to paddy agent pauses your newest live listings above 10.
            </p>
          )}
          {isPaid && !cancelled && (
            <PaddyButton
              variant="transparent-muted"
              size="sm"
              className="self-start"
              onClick={() => {
                onDismissError?.();
                setConfirmOpen(true);
              }}
            >
              Cancel plan
            </PaddyButton>
          )}
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={(next) => !cancelling && setConfirmOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display font-medium tracking-[-0.02em]">
              Cancel {effectiveMeta.label}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              It won&apos;t renew. You keep it until{" "}
              {formatDate(subscription.current_period_end)}, then move to Free:
              3 live listings, and your newest live listings above that are
              paused until you upgrade again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {actionError && (
            <p role="alert" className="text-destructive text-sm">
              {actionError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <PaddyButton variant="secondary" size="lg" disabled={cancelling}>
                Keep my plan
              </PaddyButton>
            </AlertDialogCancel>
            <PaddyButton
              variant="danger"
              size="lg"
              isLoading={cancelling}
              onClick={async () => {
                if (await onCancel?.()) setConfirmOpen(false);
              }}
            >
              Cancel plan
            </PaddyButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function UpgradeRow({
  tier,
  verb,
  busy,
  disabled,
  onUpgrade,
}: {
  tier: PaidTier;
  verb: string;
  busy: boolean;
  disabled: boolean;
  onUpgrade: (tier: PaidTier) => void;
}) {
  const meta = TIER_META[tier];
  return (
    <PaddyButton
      variant={tier === "lord" ? "primary" : "secondary"}
      size="lg"
      // PaddyButton wraps its content in one inline span; stretch it so
      // the price can sit at the right end.
      className="[&>span:first-child]:w-full"
      leftIcon={Rocket}
      isLoading={busy}
      disabled={disabled}
      onClick={() => onUpgrade(tier)}
    >
      <span className="flex-1 text-left">
        {verb} {meta.label}
      </span>
      <span className="text-xs opacity-80">
        GHS {meta.priceGhs?.toLocaleString()}/mo · {meta.cap === null ? "unlimited" : meta.cap} live
      </span>
    </PaddyButton>
  );
}
