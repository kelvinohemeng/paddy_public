// Display labels for Lease.status — the backend owns the values
// (backend/leases/models.py Lease.Status). Shared by the list and detail
// pages so a new status only needs adding once.
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
