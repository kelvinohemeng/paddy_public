"use client";
// Required — useApiList below is a client hook; same server-by-default
// reasoning as the listings page.

import { useApiList } from "@/hooks/use-api";
import { useMe } from "@/hooks/use-auth";
import { useParams, useRouter } from "next/navigation";

import { ListingCard } from "@/components/listing-card";
import { ListingGrid } from "@/components/listing-grid";
import {
  DashboardEmptyState,
  DashboardLinkButton,
  DashboardMessage,
  DashboardPage,
} from "@/components/dashboard-page";
import { DISCOVERY_PATH } from "@/app/(public)/_components/discovery-path";
import { LEASE_BADGE } from "./lease-status";

// Active Lease — "Leased Homes" in Figma 181:22594 (landlord) and
// 176:21788 (renter), read 2026-09-28: the shared Listing Card in its
// Leased state — the other party's name under the details, a status
// badge and "Review Document", which opens the lease (contracts and
// receipts live on the detail page).
//
// Read-only by design: leases are recorded by staff or landlords once a
// deal closes off-platform (paddy never moves rent or deposit money, so
// there's no payment event to create one from). Renters see their own
// leases, landlords the leases on their listings, staff all of them —
// LeaseViewSet.get_queryset does that scoping, so this page renders
// whatever arrives.
//
// Known gap: a lease row carries the listing's title but no photo, and
// the listing itself isn't readable by the renter once it's leased (the
// public queryset is published-only). So these cards show the "No photo
// yet" placeholder until LeaseSerializer grows a cover-photo field.

function formatMonth(iso?: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function formatRent(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const amount = Number(raw);
  // Same "GHC 4,000/mo" form as the listing cards (listing-card-data.ts).
  return Number.isFinite(amount)
    ? `GHC ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}/mo`
    : undefined;
}

export default function LeasesPage() {
  const params = useParams<{ user: string }>();
  const userId = params.user;
  const router = useRouter();
  const { data: identity } = useMe();
  const role: string | undefined = identity?.role;

  // GET /leases/, role-scoped by the backend.
  const { data, isLoading, isError } = useApiList("leases");

  if (isLoading) {
    return <DashboardMessage loading>Loading your leases…</DashboardMessage>;
  }

  if (isError) {
    return (
      <DashboardMessage tone="error">
        Couldn&apos;t load your leases. Refresh to try again.
      </DashboardMessage>
    );
  }

  const leases: any[] = data?.data ?? [];

  if (leases.length === 0) {
    return role === "renter" ? (
      <DashboardEmptyState
        title="You have no active lease"
        description="When a landlord records your tenancy and you confirm it, it shows up here"
        action={<DashboardLinkButton href={DISCOVERY_PATH}>Discover New Homes</DashboardLinkButton>}
      />
    ) : (
      <DashboardEmptyState
        title="No leased homes yet"
        description="When a renter confirms a lease on one of your homes, it shows up here"
        action={
          role === "landlord" ? (
            <DashboardLinkButton href={`/dashboard/${userId}/listings`}>
              View my property
            </DashboardLinkButton>
          ) : undefined
        }
      />
    );
  }

  return (
    <DashboardPage title="Leased Homes">
      <ListingGrid className="gap-x-6 gap-y-[30px]">
        {leases.map((lease: any, index: number) => {
          // A row with no id can't link anywhere — render it inert rather
          // than navigating to ".../leases/undefined".
          const leaseId = lease.id ?? lease.pk;
          const href = leaseId ? `/dashboard/${userId}/leases/${leaseId}` : undefined;

          // The other side of the lease: renters see their landlord,
          // landlords (and staff) see the renter.
          const counterpart =
            role === "renter" ? lease.landlord_name : lease.renter_name;

          const start = formatMonth(lease.start_date);
          const end = formatMonth(lease.end_date);

          return (
            <ListingCard
              key={leaseId ?? `lease-row-${index}`}
              state="leased"
              heading={lease.listing_title ?? `Listing #${lease.listing}`}
              subtitle={start && end ? `${start} – ${end}` : (start ?? "Dates not set")}
              price={formatRent(lease.rent_amount_monthly)}
              details={
                lease.advance_rent_period && lease.advance_rent_period !== "none"
                  ? [
                      lease.advance_rent_period === "6_months"
                        ? "6 months advance"
                        : "1 year advance",
                    ]
                  : []
              }
              landlord={counterpart ? { name: counterpart } : undefined}
              status={
                LEASE_BADGE[lease.status] ?? { label: String(lease.status), state: "neutral" }
              }
              href={href}
              action={
                href
                  ? { label: "Review Document", onClick: () => router.push(href) }
                  : null
              }
            />
          );
        })}
      </ListingGrid>
    </DashboardPage>
  );
}
