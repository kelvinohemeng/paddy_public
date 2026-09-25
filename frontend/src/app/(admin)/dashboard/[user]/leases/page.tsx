"use client";
// Required — useList below is a client hook; same server-by-default
// reasoning as the listings page.

import { useApiList } from "@/hooks/use-api";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CalendarDays, MapPin } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LEASE_STATUS_META } from "./lease-status";

// Active Leases dashboard (AGENTS.md build-priority #4). Read-only by
// design: leases are entered by staff/landlords in Django admin once a
// deal closes off-platform (paddy never moves rent/deposit money, so
// there is no payment event to auto-create from — see
// backend/leases/models.py). Renters see their own leases, landlords
// see leases on their own listings, staff see all — that scoping is
// enforced by LeaseViewSet.get_queryset, so this page renders whatever
// arrives with zero role branching on the data itself.

// Status labels live in ./lease-status (shared with the detail page).

export default function LeasesPage() {
  const params = useParams<{ user: string }>();
  const userId = params.user;

  // Same endpoint the old Refine useList({ resource: "leases" }) call
  // hit — GET /leases/, backend role-scoped automatically.
  const { data, isLoading, isError } = useApiList("leases");

  if (isLoading) {
    return (
      <div className="p-6">
        <p>Loading leases...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <p className="text-red-500">Failed to load leases.</p>
      </div>
    );
  }

  const leases: any[] = data?.data ?? [];

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold">Leases</h1>

      {leases.length === 0 ? (
        <p className="text-muted-foreground">
          No leases yet — once a tenancy is recorded (by staff or your
          landlord), it shows up here with its contracts and receipts.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {leases.map((lease: any, index: number) => {
            const meta = LEASE_STATUS_META[lease.status] ?? {
              label: lease.status,
              variant: "secondary" as const,
            };
            // A row with no id can't link anywhere — render it inert
            // rather than navigating to ".../leases/undefined", which
            // the detail page would (correctly) fail to load.
            const leaseId = lease.id ?? lease.pk;
            const card = (
              <Card
                className={
                  leaseId
                    ? "cursor-pointer transition hover:shadow-md"
                    : "opacity-70"
                }
              >
                <CardContent className="space-y-2 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate font-medium">
                      {lease.listing_title ?? `Listing #${lease.listing}`}
                    </p>
                    <Badge variant={meta.variant} className="shrink-0">
                      {meta.label}
                    </Badge>
                  </div>

                  <p className="text-muted-foreground flex items-center gap-1 truncate text-xs">
                    <MapPin className="size-3 shrink-0" />
                    {lease.renter_name ?? ""}
                    {lease.renter_name && lease.landlord_name && " · "}
                    {lease.landlord_name ?? ""}
                  </p>

                  <div className="text-muted-foreground flex items-center gap-3 text-xs">
                    <span className="flex items-center gap-1">
                      <CalendarDays className="size-3" />
                      {lease.start_date} → {lease.end_date}
                    </span>
                    {lease.rent_amount_monthly && (
                      <span className="text-foreground ml-auto font-medium">
                        GHS {lease.rent_amount_monthly}/mo
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
            return leaseId ? (
              <Link
                key={leaseId}
                href={`/dashboard/${userId}/leases/${leaseId}`}
              >
                {card}
              </Link>
            ) : (
              <div key={`lease-row-${index}`}>{card}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
