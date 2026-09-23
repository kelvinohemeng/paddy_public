// Single source of truth for Listing.status rendering — mirrors
// Listing.Status in backend/listings/models.py exactly:
//   DRAFT / PENDING_REVIEW / PUBLISHED / REJECTED / ARCHIVED

import { BadgeCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Clock, FileEdit, Archive, CircleX } from "lucide-react";

export type ListingStatus =
  | "draft"
  | "pending_review"
  | "published"
  | "rejected"
  | "archived";

type StatusMeta = {
  label: string;
  icon: LucideIcon;
  badgeVariant: "default" | "secondary" | "destructive" | "outline";
};

// Badge visuals per status. `destructive` is reserved for rejected
// (action-needed); published gets `default` (filled = live on the
// marketplace); everything else is `secondary` (neutral).
export const STATUS_META: Record<ListingStatus, StatusMeta> = {
  draft: { label: "Draft", icon: FileEdit, badgeVariant: "secondary" },
  pending_review: {
    label: "In review",
    icon: Clock,
    badgeVariant: "secondary",
  },
  published: { label: "Live", icon: BadgeCheck, badgeVariant: "default" },
  rejected: { label: "Rejected", icon: CircleX, badgeVariant: "destructive" },
  archived: { label: "Archived", icon: Archive, badgeVariant: "outline" },
};

// The two statuses a landlord can (once the backend's submit-for-review
// action exists) transition themselves: draft → pending_review, and
// rejected → pending_review (fix & resubmit). The CTA keys off this.
export const OWNER_ACTIONABLE: ReadonlySet<ListingStatus> = new Set<
  ListingStatus
>(["draft", "rejected"]);

// Defensive cast helper — the backend currently excludes `status` from
// ListingSerializer (docs/backend-listing-tasks.md Task 2a), so responses
// typed as `any` may or may not carry the key. Narrow it here instead of
// scattering string comparisons across components; when Task 2a lands,
// this is the ONLY file that needs touching if the wire format changes.
export function parseStatus(value: unknown): ListingStatus | null {
  if (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(STATUS_META, value)
  ) {
    return value as ListingStatus;
  }
  return null;
}
