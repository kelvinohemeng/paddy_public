import type { ReactNode } from "react";
import Link from "next/link";

import { FavoriteButton } from "@/components/favorite-button";
import { PaddyBadge, type PaddyBadgeState } from "@/components/paddy-badge";
import { PaddyButton } from "@/components/paddy-button";
import { VerifiedSealIcon } from "@/components/paddy-icons";
import { cn } from "@/lib/utils";

// paddy listing card — THE listing card, used everywhere (Discovery Hub,
// landlord and renter dashboards). Presentational: no data fetching;
// lib/listing-card-data.ts maps an API listing onto these props.
// Optional `href` makes the whole card a link.
// Spec: Figma Handoff → "Listing Card" component set (242:34970),
// read 2026-09-27 via the Figma plugin API. Figma width is 238px; the
// card is fluid and keeps every proportion below.
//
// States:
//   Default   photo + heart (outline), body, landlord row
//   Saved     same, heart solid
//   Leased    same as Default + [Leased badge][Review Document] row
//   Property  landlord's own card: photo with a hairline border, no
//             heart, + [Active badge][Review Document]
//
// Layout (all from the component):
// - column, 8px gaps between photo, body and the action row
// - photo 238x224 (aspect 17/16), 8.78px radius, #f2f2f2 placeholder;
//   heart chip 6px from the top and right edges
// - body: heading and price share the first row (price right-aligned);
//   the rest stacks full-width below, 4px gaps. (Figma splits the body
//   130:108 into two columns; at 12px that cut text off — see below.)
//     heading   Clash Display Medium 14, -2%, black 90%
//     subtitle  Plus Jakarta Sans Medium 12/16, -2%, black 70%, up to
//               two lines
//     details   one line, "2 Bedroom · 1 Bathroom", Plus Jakarta Sans
//               Medium 12/16, -2%, black 60%
//     landlord  6px above: 16px avatar circle (#f5f5f5, #d9d9d9
//               hairline) · name (Plus Jakarta 12, black 60%) · seal
//   price in the right column: Clash Display Medium 14, -2%, black 90%
// Sizes deliberately diverge from Figma (2026-09-27, Kelvin): 14px title,
// 12px for the rest, with hierarchy carried by colour instead of size.
// Figma's 10px read too small at real device distance. Black 60% on
// white (~#666) is the lightest step used: ~5.7:1, passes WCAG AA; the
// Figma 50% (~3.9:1) did not.

export type ListingCardState = "default" | "saved" | "leased" | "property";

export type ListingCardProps = {
  state?: ListingCardState;
  /** e.g. "Rent in Accra" */
  heading: string;
  /** Listing title, e.g. "Loxwood Suite WO4-20" */
  subtitle: string;
  /** Pre-formatted, e.g. "GHC 4,000/mo". Omitted → no price. */
  price?: string;
  /** Detail line parts, joined with " · " — "2 Bedroom", "1 Bathroom"… */
  details?: string[];
  imageUrl?: string | null;
  imageAlt?: string;
  /** Landlord row (all states). */
  landlord?: { name: string; verified?: boolean; avatarUrl?: string | null };
  /** Heart chip (Default / Saved / Leased). Omitted → no heart. */
  onToggleFavorite?: () => void;
  /** Leased / Property status badge. Defaults: Leased / Active. */
  status?: { label: string; state: PaddyBadgeState };
  /** Leased / Property action button. null → badge only (the landlord's
   *  dashboard grid, where the whole card opens the listing). */
  action?: { label: string; onClick?: () => void } | null;
  /** paddy staff visited and verified the home — "Verified" chip on the
   *  photo, top-left (clear of the heart). The brand promise, so it
   *  shows in every state. */
  verified?: boolean;
  /** Extra overlay on the photo. */
  photoOverlay?: ReactNode;
  /** Makes the whole card a link (Discovery → /homes/[slug], dashboard
   *  → its preview drawer). The heart and action button still work on
   *  their own without following it. */
  href?: string;
  /** Lifts the card — Discovery sets it while the card's map pin is
   *  hovered, so the split view reads as one connected view. */
  highlighted?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  id?: string;
  className?: string;
};

const DEFAULT_STATUS: Partial<
  Record<ListingCardState, ListingCardProps["status"]>
> = {
  leased: { label: "Leased", state: "information" },
  property: { label: "Active", state: "success" },
};

export function ListingCard({
  state = "default",
  heading,
  subtitle,
  price,
  details = [],
  imageUrl,
  imageAlt,
  landlord,
  onToggleFavorite,
  status,
  action = { label: "Review Document" },
  verified = false,
  photoOverlay,
  href,
  highlighted = false,
  onMouseEnter,
  onMouseLeave,
  id,
  className,
}: ListingCardProps) {
  const isProperty = state === "property";
  const showActions = state === "leased" || isProperty;
  const badge = status ?? DEFAULT_STATUS[state];

  const rootClass = cn(
    "group flex w-full flex-col gap-2",
    href &&
      "rounded-xl transition-transform duration-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black",
    highlighted && "-translate-y-1",
    className,
  );
  const rootProps = { id, onMouseEnter, onMouseLeave, className: rootClass };

  const body = (
    <>
      <div
        className={cn(
          "bg-surface relative aspect-[17/16] w-full overflow-hidden rounded-[8.78px]",
          isProperty && "ring-[0.73px] ring-hairline ring-inset",
        )}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={imageAlt ?? subtitle}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="font-label flex h-full items-center justify-center text-[10px] text-black/40">
            No photo yet
          </div>
        )}
        {verified && (
          <PaddyBadge
            state="neutral"
            size="2xs"
            leftIcon={VerifiedSealIcon}
            className="absolute top-1.5 left-1.5 border-transparent bg-white/90 text-black [&>svg]:size-2.5 [&>svg]:text-black"
          >
            Verified
          </PaddyBadge>
        )}
        {photoOverlay}
        {!isProperty && onToggleFavorite && (
          <FavoriteButton
            saved={state === "saved"}
            onToggle={onToggleFavorite}
            className="absolute top-1.5 right-1.5"
          />
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        {/* Only the heading shares a row with the price; the lines below
            get the card's full width. Figma's 130:108 two-column split
            cut off the details line and broke titles mid-word at 12px. */}
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-display min-w-0 line-clamp-2 text-md font-medium text-black/90">
            {heading}
          </p>
          {price && (
            <p className="font-label shrink-0 text-sm leading-[17px] font-medium tracking-[-0.02em] whitespace-nowrap text-black/90">
              {price}
            </p>
          )}
        </div>
        {/* Wraps to two lines rather than truncating long listing titles. */}
        <p className="font-label line-clamp-2 text-xs leading-4 font-medium tracking-[-0.02em] text-black/70">
          {subtitle}
        </p>
        {details.length > 0 && (
          <p className="font-label truncate text-xs leading-4 font-medium tracking-[-0.02em] text-black/60">
            {details.join(" · ")}
          </p>
        )}
        {landlord && (
          <div className="flex items-center gap-1 pt-1.5">
            <span className="border-hairline flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-full border-[0.4px] bg-[#f5f5f5]">
              {landlord.avatarUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={landlord.avatarUrl}
                  alt=""
                  className="size-full object-cover"
                />
              )}
            </span>
            <span className="font-label truncate text-xs leading-4 font-medium tracking-[-0.02em] text-black/60">
              {landlord.name}
            </span>
            {landlord.verified && (
              <VerifiedSealIcon
                className="shrink-0 text-black"
                role="img"
                aria-hidden={false}
                aria-label="ID-verified landlord"
              />
            )}
          </div>
        )}
      </div>

      {showActions && (
        <div className="flex items-center gap-2">
          {/* Figma stretches the Xsmall badge to the 28px row height. */}
          {badge && (
            <PaddyBadge state={badge.state} className="h-7">
              {badge.label}
            </PaddyBadge>
          )}
          {action && (
            <PaddyButton
              variant="secondary"
              size="sm"
              onClick={(e) => {
                // Inside a card link: act, don't navigate.
                if (href) {
                  e.preventDefault();
                  e.stopPropagation();
                }
                action.onClick?.();
              }}
            >
              {action.label}
            </PaddyButton>
          )}
        </div>
      )}
    </>
  );

  return href ? (
    <Link href={href} {...rootProps}>
      {body}
    </Link>
  ) : (
    <div {...rootProps}>{body}</div>
  );
}
