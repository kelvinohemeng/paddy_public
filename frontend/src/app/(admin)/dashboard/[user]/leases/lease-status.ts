import type { PaddyBadgeState } from "@/components/paddy-badge";

// Display labels for Lease.status — the backend owns the values
// (backend/leases/models.py Lease.Status). Shared by the list and detail
// pages so a new status only needs adding once.

// The paddy status chip on the Leased Homes cards. Figma draws an active
// lease as "Leased" in the Information (blue) state; the others follow
// the listing-status colours: amber while waiting on someone, red when
// declined, grey once it's over.
export const LEASE_BADGE: Record<string, { label: string; state: PaddyBadgeState }> = {
  pending: { label: "Awaiting confirmation", state: "warning" },
  active: { label: "Leased", state: "information" },
  declined: { label: "Declined", state: "error" },
  ended: { label: "Ended", state: "neutral" },
  terminated: { label: "Terminated", state: "neutral" },
};

export const LEASE_STATUS_META: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  // Landlord-recorded leases start here until the renter confirms
  // (POST /leases/<id>/confirm/) or declines (POST /leases/<id>/decline/).
  pending: { label: "Awaiting confirmation", variant: "outline" },
  active: { label: "Active", variant: "default" },
  declined: { label: "Declined", variant: "destructive" },
  ended: { label: "Ended", variant: "secondary" },
  terminated: { label: "Terminated", variant: "outline" },
};
