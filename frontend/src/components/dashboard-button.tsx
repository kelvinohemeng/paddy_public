import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { PaddyIcon, type PaddyIconName } from "@/components/paddy-icons";
import { cn } from "@/lib/utils";

// paddy dashboard button primitive — Medusa-referenced, shadcn-built.
// Spec: Handoff → "Dashboard Button" component set (242:3911), 2
// states: Active / Default. Sidebar/nav row: leading Paddy Icon +
// label, flanked by two small "plus-mini" accessory vectors.
//
// Improv decision: the two "plus-mini" instances in Figma serialize
// with zero-area vector paths (line strokes, not fills) so their
// exact glyph can't be read from the relay snapshot. Rendered here
// as a single trailing chevron (expand/active affordance) instead of
// two flanking marks — flag if the design intent was different.

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
  className,
}: {
  icon: PaddyIconName;
  label: string;
  active?: boolean;
  href?: string;
  onClick?: () => void;
  collapsed?: boolean;
  className?: string;
}) {
  const content = (
    <>
      <PaddyIcon name={icon} className="size-5 shrink-0" />
      {!collapsed && (
        <span className="flex-1 truncate text-left">{label}</span>
      )}
      {active && !collapsed && (
        <ChevronRight className="size-[15px] shrink-0 opacity-60" aria-hidden />
      )}
    </>
  );
  const styles = cn(
    "flex h-10 w-full items-center gap-2.5 rounded-lg px-4 text-sm font-medium transition",
    collapsed && "justify-center px-0",
    active
      ? "bg-[#FAFAFA] text-[#17171C]"
      : "bg-transparent text-[#17171C] hover:bg-[#FAFAFA]",
    className,
  );

  if (href) {
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? label : undefined}
        onClick={onClick}
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
      onClick={onClick}
      className={styles}
    >
      {content}
    </button>
  );
}
