import { Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// paddy button primitive — Medusa-referenced, shadcn-built.
// Spec: Primitive Handoff → Button set 239:142144
// (Style × Size × State × Radius=Rounded, full 60-variant read
// 2026-09-22 — sizes are Small 28h / Base 32h / Large 36h).
//
// One component, five styles, three sizes. Composes shadcn's
// Button (a11y, asChild, form props) and overrides its visuals
// via className — tailwind-merge keeps these later classes over
// the base variants. shadcn/ui stays upgradeable; Figma values
// live here.
//
// Improv decisions (flagged, per handoff answers):
// - Radius fixed 6px (rounded-md) — the set only ships Rounded.
// - Secondary border: 1px border-input (strokes invisible to relay).
// - No custom focus ring (explicit). shadcn's base focus-visible
//   treatment is left untouched, not extended.
// - Light theme only (paddy has no dark mode) — no dark: fallbacks.
// - Secondary/Danger Large hover+pressed+disabled: the set only
//   ships Default for those — derived from the Small/Base ramps.

export type PaddyButtonStyle =
  | "primary"
  | "secondary"
  | "transparent"
  | "transparent-muted"
  | "danger";

export type PaddyButtonSize = "sm" | "base" | "lg";

const STYLE_CLASSES: Record<PaddyButtonStyle, string> = {
  // Primary ramp: #262629 → hover #404044 → pressed #52525C,
  // label white at 88%. hover:text is explicit (not inherit) so the
  // label stays light on the dark fill — shadcn ghost's
  // hover:text-accent-foreground would otherwise turn it dark.
  primary:
    "bg-[#262629] text-white/90 shadow-xs hover:bg-[#404044] hover:text-white/90 active:bg-[#52525C]",
  // Secondary: white, 1px border; hover #F5F5F5, pressed #E3E3E6.
  secondary:
    "border border-input bg-white text-[#17171C] shadow-xs hover:bg-[#F5F5F5] hover:text-[#17171C] active:bg-[#E3E3E6]",
  // Transparent: no fill until hover; muted variant dims the label.
  transparent:
    "bg-transparent text-[#17171C] hover:bg-[#F5F5F5] hover:text-[#17171C] active:bg-[#E3E3E6]",
  "transparent-muted":
    "bg-transparent text-[#70707A] hover:bg-[#F5F5F5] hover:text-[#70707A] active:bg-[#E3E3E6]",
  // Danger ramp: #E01C47 → hover #BF123D → pressed #9E1238.
  danger:
    "bg-[#E01C47] text-white shadow-xs hover:bg-[#BF123D] hover:text-white active:bg-[#9E1238]",
};

const SIZE_CLASSES: Record<PaddyButtonSize, string> = {
  sm: "h-7 px-3.5 text-[13px]",
  base: "h-8 px-4 text-[13px]",
  lg: "h-9 px-5 text-[13px]",
};

// Single Disabled treatment across all five styles.
const DISABLED_CLASSES =
  "disabled:border-transparent disabled:bg-[#F5F5F5] disabled:text-[#A1A1AA] disabled:shadow-none disabled:opacity-100";

export function PaddyButton({
  variant = "primary",
  size = "base",
  leftIcon: LeftIcon,
  rightIcon: RightIcon,
  isLoading = false,
  disabled = false,
  onClick,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "onClick"> & {
  variant?: PaddyButtonStyle;
  size?: PaddyButtonSize;
  leftIcon?: LucideIcon;
  rightIcon?: LucideIcon;
  /** Manual override: spinner + interaction suppressed, style kept. */
  isLoading?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const busy = isLoading;
  return (
    <Button
      variant="ghost"
      data-style={variant}
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={(e) => {
        if (busy) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      className={cn(
        // No hover:text here on purpose: each style above owns its
        // hover label color explicitly, which neutralizes shadcn
        // ghost's hover:text-accent-foreground (it merges earlier, so
        // tailwind-merge keeps the style's later class). A blanket
        // hover:text-inherit here would turn the primary/danger label
        // dark on hover while the fill stays dark.
        "rounded-md font-medium whitespace-nowrap",
        STYLE_CLASSES[variant],
        SIZE_CLASSES[size],
        DISABLED_CLASSES,
        className,
      )}
      {...props}
    >
      {busy && <Loader2 className="size-[15px] animate-spin" aria-hidden />}
      {!busy && LeftIcon && (
        <LeftIcon className="size-[15px]" aria-hidden />
      )}
      {children}
      {!busy && RightIcon && (
        <RightIcon className="size-[15px]" aria-hidden />
      )}
    </Button>
  );
}
