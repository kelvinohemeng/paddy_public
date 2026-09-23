"use client";
// Dashboard homepage — where every user lands after sign-in
// (useLogin redirects to "/dashboard", which resolves here).
// Role-aware cards with live counts; the cards link to the same
// routes the sidebar points at.

import { useApiList } from "@/hooks/use-api";
import { useMe } from "@/hooks/use-auth";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Building2, FileText, Heart, User, ArrowRight, ShieldCheck } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { parseStatus } from "@/lib/listing-status";

function HomeCard({
  href,
  icon: Icon,
  title,
  blurb,
  count,
  countLabel,
}: {
  href: string;
  icon: React.ElementType;
  title: string;
  blurb: string;
  count?: number;
  countLabel?: string;
}) {
  return (
    <Link href={href}>
      <Card className="h-full cursor-pointer transition hover:shadow-md">
        <CardContent className="space-y-2 py-5">
          <div className="flex items-center gap-2">
            <Icon className="size-5" />
            <p className="font-semibold">{title}</p>
            <ArrowRight className="text-muted-foreground ml-auto size-4" />
          </div>
          <p className="text-muted-foreground text-sm">{blurb}</p>
          {count !== undefined && (
            <p className="text-2xl font-bold">
              {count}{" "}
              <span className="text-muted-foreground text-xs font-normal">
                {countLabel}
              </span>
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

export default function DashboardHomePage() {
  const params = useParams<{ user: string }>();
  const userId = params.user;
  const { data: identity } = useMe();
  const role: string | undefined = identity?.role;

  // Live counts — same endpoints the section pages read, so the numbers
  // always agree with what the user finds when they click through.
  // Skipped queries per role via `enabled` (no point fetching
  // landlord-only counts for a renter and vice versa).
  const isLandlordSide =
    role === undefined ||
    ["landlord", "staff", "admin"].includes(role);
  const isRenterSide = role === undefined || role === "renter";

  const listingsCount = useApiList("listings", {
    // Landlords: exact own-listings count (the same ?mine=true scope
    // the subscription cap counts). Staff/admins: whole marketplace.
    filters:
      role === "landlord" ? [{ field: "mine", value: "true" }] : [],
    enabled: isLandlordSide,
  });
  const leasesCount = useApiList("leases", { enabled: role !== undefined });
  const savedCount = useApiList("listings/saved", { enabled: isRenterSide });

  const displayName =
    identity?.profile?.full_name || identity?.email || "there";

  // Review-queue badge for staff/admin. Same full-list fetch as the
  // Listings card above (staff/admins see every status, no ?mine
  // filter), same client-side pending_review filter as the queue page
  // itself — the number always agrees with the queue. No backend
  // pagination is configured, so this sees the whole list.
  const isReviewer =
    role !== undefined && ["staff", "admin"].includes(role);
  const pendingCount =
    isReviewer && Array.isArray(listingsCount.data?.data)
      ? listingsCount.data.data.filter(
          (l: any) => parseStatus(l.status) === "pending_review",
        ).length
      : undefined;

  return (
    <div className="p-6">

      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-bold">Welcome, {displayName}</h1>
        {role && <Badge variant="secondary">{role}</Badge>}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLandlordSide && (
          <HomeCard
            href={`/dashboard/${userId}/listings`}
            icon={Building2}
            title="Listings"
            blurb={
              role === "landlord"
                ? "Create, edit and track your listings through verification."
                : "All marketplace listings."
            }
            count={listingsCount.data?.total}
            countLabel={role === "landlord" ? "yours" : "total"}
          />
        )}

        <HomeCard
          href={`/dashboard/${userId}/leases`}
          icon={FileText}
          title="Leases"
          blurb={
            role === "renter"
              ? "Your tenancies, contracts and payment receipts."
              : "Tenancies on your listings, with contracts and receipts."
          }
            count={role !== undefined ? leasesCount.data?.total : undefined}
          countLabel="total"
        />

        {isRenterSide && (
          <HomeCard
            href={`/dashboard/${userId}/saved`}
            icon={Heart}
            title="Saved Homes"
            blurb="Homes you tapped the heart on — compare and revisit."
            count={savedCount.data?.total}
            countLabel="saved"
          />
        )}

        {isReviewer && (
          <HomeCard
            href={`/dashboard/${userId}/reviews`}
            icon={ShieldCheck}
            title="Review queue"
            blurb="Landlord submissions awaiting verification before going live."
            count={pendingCount}
            countLabel="pending"
          />
        )}

        <HomeCard
          href={`/dashboard/${userId}/profile`}
          icon={User}
          title="Profile"
          blurb={
            role === "renter"
              ? "Your renter CV — what landlords see when you enquire."
              : "Your public profile details."
          }
        />
      </div>
    </div>
  );
}
