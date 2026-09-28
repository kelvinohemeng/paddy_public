// Single source of truth for Listing.status rendering — mirrors
// Listing.Status in backend/listings/models.py exactly:
//   DRAFT / PENDING_REVIEW / PUBLISHED / REJECTED / ARCHIVED / LEASED /
//   PAUSED
// PAUSED is set by the backend only (payments/limits.py, PR #34): when a
// landlord's plan lapses or is downgraded, their newest live listings
// above the new limit are paused — hidden from renters, restored on their
// own once the landlord pays again.

import { BadgeCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PaddyBadgeState } from "@/components/paddy-badge";
import {
  Clock,
  FileEdit,
  Archive,
  CircleX,
  CirclePause,
  KeyRound,
} from "lucide-react";

export type ListingStatus =
  | "draft"
  | "pending_review"
  | "published"
  | "rejected"
  | "archived"
  | "leased"
  | "paused";

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
  // Set by the backend when a renter confirms a lease on the listing.
  leased: { label: "Leased", icon: KeyRound, badgeVariant: "secondary" },
  // Set by the backend when the plan's live limit drops below this
  // listing (see the header comment).
  paused: { label: "Paused", icon: CirclePause, badgeVariant: "outline" },
};

// The two statuses a landlord can transition themselves: draft →
// pending_review, and rejected → pending_review (fix & resubmit). The
// Submit CTA keys off this. Paused is deliberately NOT here: a paused
// listing was already verified and comes back on its own when the
// landlord pays — submitting it again would put it back in the staff
// queue for nothing. It can still be archived.
export const OWNER_ACTIONABLE: ReadonlySet<ListingStatus> = new Set<
  ListingStatus
>(["draft", "rejected"]);

// Colour of the status chip on the paddy listing card (dashboard
// Listings grid): grey for not-live states, amber while waiting on
// staff or paused by the plan (both need a look, neither is an error),
// green when live, red when action is needed, blue once leased.
export const STATUS_BADGE_STATE: Record<ListingStatus, PaddyBadgeState> = {
  draft: "neutral",
  pending_review: "warning",
  published: "success",
  rejected: "error",
  archived: "neutral",
  leased: "information",
  paused: "warning",
};

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
