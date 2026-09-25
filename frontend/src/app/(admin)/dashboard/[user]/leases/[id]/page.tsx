"use client";
// Lease detail: terms + contracts/receipts timeline. Same read-only
// reasoning as the leases list — renters can read their own
// receipts/contracts but never create them (LeaseRecordViewSet allows
// GET+POST with perform_create restricted to staff/landlords, and no
// update/delete at all: a logged receipt is a historical fact).

import { useState } from "react";
import { toast } from "sonner";
import { useApiInvalidate, useApiOne } from "@/hooks/use-api";
import { useMe } from "@/hooks/use-auth";
import { apiPost } from "@/lib/api-client";
import { errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FileText, Receipt } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LEASE_STATUS_META } from "../lease-status";


function Term({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value ?? "—"}</span>
    </div>
  );
}

export default function LeaseDetailPage() {
  const params = useParams<{ user: string; id: string }>();
  const userId = params.user;

  const { data: leaseData, isLoading, isError, error } = useApiOne(
    "leases",
    params.id,
  );

  if (isLoading) {
    return (
      <div className="p-6">
        <p>Loading lease...</p>
      </div>
    );
  }

  // Separate "request failed" from "request ok but empty" — they mean
  // different things (no permission/server error vs. bad id), and the
  // distinction is what actually diagnoses a report like "could not
  // load this lease". The api-client throws ApiError {message,
  // statusCode} (see lib/api-client), so surface both, plus the id that
  // was requested — a literal "undefined" here means the LIST handed
  // us a row with no id, which is a list bug, not a detail bug.
  if (isError) {
    const err = error as unknown as {
      message?: string;
      statusCode?: number;
    };
    console.error("Lease detail failed:", {
      id: params.id,
      statusCode: err?.statusCode,
      message: err?.message,
    });
    return (
      <div className="space-y-3 p-6">
        <p className="font-medium text-red-500">
          Could not load this lease
          {err?.statusCode ? ` (HTTP ${err.statusCode})` : ""}.
        </p>
        {err?.message && (
          <p className="text-muted-foreground text-sm">{err.message}</p>
        )}
        <p className="text-muted-foreground text-xs">
          Requested lease id: {String(params.id)}
        </p>
        <Link
          href={`/dashboard/${userId}/leases`}
          className="text-sm text-indigo-600 underline"
        >
          Back to leases
        </Link>
      </div>
    );
  }

  if (!leaseData) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-muted-foreground">
          This lease doesn&apos;t exist (or was removed).
        </p>
        <Link
          href={`/dashboard/${userId}/leases`}
          className="text-sm text-indigo-600 underline"
        >
          Back to leases
        </Link>
      </div>
    );
  }

  const lease: any = leaseData;
  const meta = LEASE_STATUS_META[lease.status] ?? {
    label: lease.status,
    variant: "secondary" as const,
  };
  // Nested read-only records arrive inside the lease payload itself
  // (LeaseSerializer.records) — no second fetch needed.
  const records: any[] = Array.isArray(lease.records) ? lease.records : [];

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold leading-tight">
          {lease.listing_title ?? `Listing #${lease.listing}`}
        </h1>
        <Badge variant={meta.variant} className="shrink-0">
          {meta.label}
        </Badge>
      </div>

      {lease.status === "pending" && <PendingLeaseNotice lease={lease} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tenancy terms</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <Term label="Renter" value={lease.renter_name} />
          <Term label="Landlord" value={lease.landlord_name} />
          <Term
            label="Rent"
            value={
              lease.rent_amount_monthly
                ? `GHS ${lease.rent_amount_monthly}/mo`
                : null
            }
          />
          <Term
            label="Deposit"
            value={lease.deposit_amount ? `GHS ${lease.deposit_amount}` : null}
          />
          <Term
            label="Advance period"
            value={lease.advance_rent_period?.replace("_", " ")}
          />
          <Term label="Start" value={lease.start_date} />
          <Term label="End" value={lease.end_date} />
          {lease.listing && (
            <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
              <span className="text-muted-foreground">Listing</span>
              <Link
                href={`/homes/${lease.listing}`}
                className="font-medium text-indigo-600 underline"
              >
                View property
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-lg font-semibold">
          Contracts & receipts ({records.length})
        </h2>
        {records.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing logged yet — contracts and payment receipts appear
            here once staff or the landlord records them.
          </p>
        ) : (
          <div className="space-y-3">
            {records.map((record: any) => (
              <Card key={record.id}>
                <CardContent className="flex items-start gap-3 py-4">
                  {record.record_type === "contract" ? (
                    <FileText className="mt-0.5 size-4 shrink-0" />
                  ) : (
                    <Receipt className="mt-0.5 size-4 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium capitalize">
                        {record.record_type}
                      </span>
                      {record.amount && (
                        <span className="font-medium">
                          GHS {record.amount}
                        </span>
                      )}
                      <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                        {record.occurred_at}
                      </span>
                    </div>
                    {(record.method || record.reference) && (
                      <p className="text-muted-foreground mt-1 text-xs">
                        {[record.method, record.reference]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                    {record.notes && (
                      <p className="mt-1 whitespace-pre-wrap text-sm">
                        {record.notes}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Shown while a landlord-recorded lease waits for the renter
// (Lease.status "pending"). The renter gets Confirm / Decline; everyone
// else who can see the lease (the landlord, staff) gets an explanation.
// The backend enforces who may answer — these buttons are convenience,
// not the security boundary.
function PendingLeaseNotice({ lease }: { lease: any }) {
  const { data: me } = useMe();
  const invalidate = useApiInvalidate();
  const [busy, setBusy] = useState<"confirm" | "decline" | null>(null);

  const isRenter = me?.role === "renter";

  async function respond(action: "confirm" | "decline") {
    setBusy(action);
    try {
      await apiPost(`/leases/${lease.id}/${action}/`);
      // Leases AND listings are refreshed: confirming flips the listing
      // to "leased" on the backend.
      await invalidate(["leases", "listings"]);
      toast.success(action === "confirm" ? "Lease confirmed" : "Lease declined");
    } catch (err) {
      toast.error(errorMessage(err, "Could not update this lease"));
    } finally {
      setBusy(null);
    }
  }

  if (!isRenter) {
    return (
      <p className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">
        Waiting for {lease.renter_name || "the renter"} to confirm this lease. It
        becomes active, and the listing is marked as leased, once they do.
      </p>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <p className="text-sm">
          {lease.landlord_name || "Your landlord"} recorded this lease with you as the
          renter. Please check the terms below, then confirm it if it&apos;s right.
        </p>
        <div className="flex gap-2">
          <Button onClick={() => respond("confirm")} disabled={busy !== null}>
            {busy === "confirm" ? "Confirming…" : "Confirm lease"}
          </Button>
          <Button variant="outline" onClick={() => respond("decline")} disabled={busy !== null}>
            {busy === "decline" ? "Declining…" : "This isn’t mine"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
