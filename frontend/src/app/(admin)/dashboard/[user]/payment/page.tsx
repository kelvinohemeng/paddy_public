"use client";
// Payment — the landlord's plan and billing. The Accounts frames' nav has
// a "Payment" row (Figma 181:22493, "Paddy Icons / Paymemts"); this is
// the page behind it. It holds the subscription card that used to sit
// above the My Property grid, where the frames leave no room for it.
//
// Everyone else (renters, in the nav) sees receipts for their one-off
// listing unlocks instead: GET /payments/unlocks/, the same query as the
// Unlocked Listings page.

import { format } from "date-fns";

import { useApiList } from "@/hooks/use-api";
import { useMe } from "@/hooks/use-auth";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DashboardEmptyState,
  DashboardLinkButton,
  DashboardMessage,
  DashboardPage,
} from "@/components/dashboard-page";
import { DISCOVERY_PATH } from "@/app/(public)/_components/discovery-path";
import type { ListingUnlock } from "@/lib/payments";
import { SubscriptionCard } from "../listings/_components/subscription-card";

export default function PaymentPage() {
  const { data: identity, isLoading } = useMe();
  const role: string | undefined = identity?.role;

  if (isLoading || !identity) {
    return <DashboardMessage loading>Loading your plan…</DashboardMessage>;
  }

  if (role !== "landlord") {
    return <UnlockReceipts />;
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

// One row per unlock, newest first: what they'd quote to support.
function UnlockReceipts() {
  const { data, isLoading, isError } = useApiList<ListingUnlock>("payments/unlocks");

  if (isLoading) {
    return <DashboardMessage loading>Loading your payments…</DashboardMessage>;
  }

  if (isError) {
    return (
      <DashboardMessage tone="error">
        Couldn&apos;t load your payments. Refresh to try again.
      </DashboardMessage>
    );
  }

  const unlocks = data?.data ?? [];

  if (unlocks.length === 0) {
    return (
      <DashboardEmptyState
        title="No payments yet"
        description="Unlocking a home's address and contact is a one-off payment on its listing page."
        action={<DashboardLinkButton href={DISCOVERY_PATH}>Discover New Homes</DashboardLinkButton>}
      />
    );
  }

  return (
    <DashboardPage title="Payment">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Home</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            {/* Phones: the reference sits under the home instead (it's what
                they'd quote to support, so it mustn't scroll out of view). */}
            <TableHead className="max-sm:hidden">Reference</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {unlocks.map((unlock) => (
            <TableRow key={unlock.id}>
              <TableCell>{format(new Date(unlock.created_at), "d MMM yyyy")}</TableCell>
              <TableCell className="whitespace-normal">
                {unlock.listing_detail.title}
                <span className="block font-mono text-xs break-all text-black/60 sm:hidden">
                  {unlock.paystack_reference}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {unlock.amount_pesewas === null ? (
                  // Older unlocks didn't store the amount (contract C1).
                  <>
                    <span aria-hidden>—</span>
                    <span className="sr-only">Not recorded</span>
                  </>
                ) : (
                  `GHC ${(unlock.amount_pesewas / 100).toFixed(2)}`
                )}
              </TableCell>
              <TableCell className="font-mono text-xs max-sm:hidden">
                {unlock.paystack_reference}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DashboardPage>
  );
}
