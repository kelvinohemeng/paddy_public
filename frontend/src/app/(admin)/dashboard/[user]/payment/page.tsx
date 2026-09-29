"use client";
// Payment — the landlord's plan and billing. The Accounts frames' nav has
// a "Payment" row (Figma 181:22493, "Paddy Icons / Paymemts"); this is
// the page behind it. It holds the subscription card that used to sit
// above the My Property grid, where the frames leave no room for it.
//
// Landlords only for now. Renters also pay (one-off listing unlocks),
// but there's no endpoint that lists a renter's unlock payments yet, so a
// renter Payment page would have nothing to show — the nav hides the row
// for them, and this page points them back if they type the URL.

import { useMe } from "@/hooks/use-auth";
import {
  DashboardEmptyState,
  DashboardLinkButton,
  DashboardMessage,
  DashboardPage,
} from "@/components/dashboard-page";
import { DISCOVERY_PATH } from "@/app/(public)/_components/discovery-path";
import { SubscriptionCard } from "../listings/_components/subscription-card";

export default function PaymentPage() {
  const { data: identity, isLoading } = useMe();
  const role: string | undefined = identity?.role;

  if (isLoading || !identity) {
    return <DashboardMessage loading>Loading your plan…</DashboardMessage>;
  }

  if (role !== "landlord") {
    return (
      <DashboardEmptyState
        title="Nothing to pay here"
        description="Unlocking a home's address and contact is a one-off payment on its listing page."
        action={<DashboardLinkButton href={DISCOVERY_PATH}>Discover New Homes</DashboardLinkButton>}
      />
    );
  }

  return (
    <DashboardPage title="Payment" width="md">
      {/* id="subscription": the listing form's "Upgrade to submit" saves
          the draft, then lands here (…/payment#subscription). */}
      <div id="subscription" className="scroll-mt-6">
        <SubscriptionCard />
      </div>
    </DashboardPage>
  );
}
