import type { ComponentType } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { PaddyBadge } from "@/components/paddy-badge";
import {
  PaddyIcon,
  PlusMiniIcon,
  type PaddyIconName,
} from "@/components/paddy-icons";
import { cn } from "@/lib/utils";

// paddy dashboard nav button.
// Spec: Figma Handoff → "Dashboard Button" component set (242:3911),
// re-read 2026-09-28 through the Figma plugin API. The set has ONE
// property, State = Active | Default:
//   both    40px tall, padding 10/16, 6px gap, square corners (radius 0)
//           20px Paddy Icon (#111111, --color-paddy-gray-1) + label
//           Inter Medium 14/20 #18181b (--foreground)
//   Active  #f9f9f9 fill (--sidebar-accent)
//   Default no fill
//
// Two things the earlier version got wrong, now fixed:
// - It had rounded corners; the set is square.
// - The two "plus-mini" instances (11:1354) are real: a plus sign, 10px
//   strokes, 1.5 wide, round caps, #52525b. They sit before the icon and
//   after the label, and are HIDDEN in both variants (and in every
//   instance in the Accounts screens). So nothing shows by default; the
//   leadingMark / trailingMark props switch them on, mirroring Figma's
//   visibility toggles. The trailing chevron the old version drew instead
//   is gone.
//
// Default's shadow: the Default variant carries the Secondary button's
// shadow stack (1px rgba(0,0,0,.08) ring + 0 1px 2px rgba(0,0,0,.12)).
// Because that frame has no fill, Figma casts the shadow from the icon
// and label glyphs only, where it's invisible — the screens show a plain
// row with no outline. A CSS box-shadow would draw a visible ring round
// the whole box, so it's left off to match what the design renders.
//
// Not in the set (added for the web, flag if the design wants otherwise):
// - Hover: the Active fill, so hovering previews the selected look.
// - Keyboard focus: the same 2px white gap + 4px blue ring PaddyButton
//   uses (Figma's Focus state on the Button set).
// - Disabled ("coming soon"): the set has no Disabled state. The landlord
//   nav shows Analytics before it exists (Kelvin, 2026-10-01), so a
//   disabled row is drawn at half opacity with no hover, isn't a link or
//   a button, and carries a small neutral PaddyBadge ("Soon") after the
//   label.
// - External: a row that leaves the app (the admin's Django admin link)
//   opens in a new tab, with an up-right arrow after the label so that's
//   clear before clicking.
//
// Height: the set is 40px, but every instance in the Accounts – Landlord
// screens (e.g. 288:8272) overrides the padding to 12/16, i.e. 44px. The
// sidebar passes that override through className.

type IconComponent = ComponentType<{ className?: string }>;

export function DashboardButton({
  icon,
  label,
  active = false,
  // Navigation mode: renders a Link with identical visuals (valid
  // HTML — no button-in-anchor). Action mode stays a plain button.
  href,
  onClick,
  // Collapsed sidebar rail: icon only, centered, label hidden.
  collapsed = false,
  leadingMark = false,
  trailingMark = false,
  disabled = false,
  badge,
  external = false,
  className,
}: {
  /** A Paddy Icons name, or any icon component for items the set has no
   *  glyph for (it's sized and coloured the same way). */
  icon: PaddyIconName | IconComponent;
  label: string;
  active?: boolean;
  href?: string;
  onClick?: () => void;
  collapsed?: boolean;
  /** Figma's hidden plus-mini before the icon. */
  leadingMark?: boolean;
  /** Figma's hidden plus-mini after the label. */
  trailingMark?: boolean;
  /** Not available yet: drawn muted and not clickable. href/onClick are
   *  ignored. Pair with `badge` to say why. */
  disabled?: boolean;
  /** A small badge after the label, e.g. "Soon". */
  badge?: string;
  /** href leaves the app: opens in a new tab. */
  external?: boolean;
  className?: string;
}) {
  const Icon = typeof icon === "string" ? null : icon;
  const content = (
    <>
      {leadingMark && !collapsed && (
        <PlusMiniIcon className="text-subtle-foreground shrink-0" />
      )}
      {Icon ? (
        <Icon className="text-paddy-gray-1 size-5 shrink-0" />
      ) : (
        <PaddyIcon
          name={icon as PaddyIconName}
          className="text-paddy-gray-1 size-5 shrink-0"
        />
      )}
      {!collapsed && (
        <span className="flex-1 truncate text-left">{label}</span>
      )}
      {badge && !collapsed && <PaddyBadge size="2xs">{badge}</PaddyBadge>}
      {external && !collapsed && (
        <ArrowUpRight className="text-subtle-foreground size-4 shrink-0" aria-hidden />
      )}
      {external && <span className="sr-only">(opens in a new tab)</span>}
      {trailingMark && !collapsed && (
        <PlusMiniIcon className="text-subtle-foreground shrink-0" />
      )}
    </>
  );
  const styles = cn(
    "text-foreground flex h-10 w-full items-center gap-1.5 rounded-none px-4 py-2.5 text-sm leading-5 font-medium outline-none transition-[background-color,box-shadow]",
    "hover:bg-sidebar-accent focus-visible:shadow-[0_0_0_2px_#fff,0_0_0_4px_rgb(59_130_246/0.6)]",
    active ? "bg-sidebar-accent" : "bg-transparent",
    collapsed && "justify-center px-0",
    className,
  );

  if (disabled) {
    // Not a link or a button: there's nothing to do here yet. The title
    // says why on hover, and aria-disabled tells screen readers.
    return (
      <div
        aria-disabled="true"
        aria-label={collapsed ? label : undefined}
        title={badge ? `${label} (${badge.toLowerCase()})` : label}
        data-state="disabled"
        className={cn(styles, "cursor-not-allowed opacity-50 hover:bg-transparent")}
      >
        {content}
      </div>
    );
  }

  if (href && external) {
    // A plain <a>, not next/link: the page is outside this app, so
    // there's nothing for client-side navigation to do.
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={collapsed ? `${label} (opens in a new tab)` : undefined}
        title={collapsed ? label : undefined}
        onClick={onClick}
        data-state="default"
        className={styles}
      >
        {content}
      </a>
    );
  }

  if (href) {
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? label : undefined}
        title={collapsed ? label : undefined}
        onClick={onClick}
        data-state={active ? "active" : "default"}
        className={styles}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      onClick={onClick}
      data-state={active ? "active" : "default"}
      className={styles}
    >
      {content}
    </button>
  );
}
