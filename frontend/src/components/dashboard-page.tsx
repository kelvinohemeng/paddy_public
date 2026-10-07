import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, Loader2 } from "lucide-react";

import { paddyButtonClassName } from "@/components/paddy-button";
import { cn } from "@/lib/utils";

// Page building blocks for the dashboard, drawn from the Accounts frames
// (Figma 181:22493 Landlord, 174:20049 Renter, 181:23169 Dashboard),
// read 2026-09-28. Every dashboard page renders inside the grey panel
// from shell/layout.tsx and uses these, so the pages stay in step.
//
//   Title     Clash Display Medium 22, -2% tracking, black at 80%
//   Columns   "lg" 762px — card lists: three 238px cards, 24px apart
//             "md" 443px — the profile
//   Top gap   card lists: the title row starts 115px below the panel top;
//             the profile starts at 93px (both at 1440x1024)
//   Cards     40px under the title row, 24px across and 30px down
//             between cards (the grid itself is ListingGrid)

export const PAGE_TITLE_CLASS =
  "font-display text-[22px] leading-[27px] font-medium tracking-[-0.02em] text-black/80";

export function DashboardPage({
  title,
  action,
  width = "lg",
  className,
  children,
}: {
  /** Omitted → no title row (the profile draws its own header). */
  title?: ReactNode;
  /** Right side of the title row, e.g. "Add a new property". */
  action?: ReactNode;
  width?: "lg" | "md";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "w-full px-4 pt-8 pb-16 md:px-8 md:pt-16 relative",
        width === "lg" ? "lg:pt-[115px]" : "lg:pt-[93px]",
        className,
      )}
    >
      <div
        className={cn(
          "mx-auto w-full",
          width === "lg" ? "max-w-[762px]" : "max-w-[443px]",
        )}
      >
        {title && (
          <div className="mb-8 flex min-h-8 flex-wrap items-center justify-between gap-3 md:mb-10">
            <h1 className={PAGE_TITLE_CLASS}>{title}</h1>
            {action}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

// A titled block inside a page — the Dashboard frame's "Saved Homes" row:
// title on the left, "View All …" (Transparent Small button with a
// chevron) on the right, cards 20px below.
export function DashboardSection({
  title,
  viewAllHref,
  viewAllLabel,
  className,
  children,
}: {
  title: ReactNode;
  viewAllHref?: string;
  viewAllLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("flex flex-col gap-5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={PAGE_TITLE_CLASS}>{title}</h2>
        {viewAllHref && viewAllLabel && (
          <Link
            href={viewAllHref}
            className={paddyButtonClassName({ variant: "transparent", size: "sm" })}
          >
            {viewAllLabel}
            <ChevronRight className="size-[15px]" aria-hidden />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

// Empty state — Figma "No Property" (181:22625) / "No Saved Homes"
// (175:21179): a character pose, 36px gap, then a 22px title, a 14px
// line and a primary button, 12px apart, all centred in the panel.
// The frames hold a placeholder box marked "Character Pose relevant to
// page"; until those poses exist, the logo mascot stands in (at its 1x
// export size, 108x122).
export function DashboardEmptyState({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-9 px-4 py-16 text-center">
      {/* Decorative. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/paddy-mascot.png"
        alt=""
        aria-hidden
        width={108}
        height={122}
        className="h-[122px] w-[108px]"
      />
      <div className="flex max-w-[421px] flex-col items-center gap-3">
        <h1 className={PAGE_TITLE_CLASS}>{title}</h1>
        {description && (
          <p className="font-display text-sm leading-[17px] font-medium tracking-[-0.02em] text-black/80">
            {description}
          </p>
        )}
        {action}
      </div>
    </div>
  );
}

// Loading and error lines, centred in the panel so a page never jumps
// from a corner message to its full layout.
export function DashboardMessage({
  loading = false,
  tone = "muted",
  children,
}: {
  loading?: boolean;
  tone?: "muted" | "error";
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 px-4 py-16 text-sm",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </div>
  );
}

// Primary / Secondary button look on a Link (navigation, not an action).
export function DashboardLinkButton({
  href,
  variant = "primary",
  size = "base",
  children,
}: {
  href: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "base";
  children: ReactNode;
}) {
  return (
    <Link href={href} className={paddyButtonClassName({ variant, size })}>
      {children}
    </Link>
  );
}
