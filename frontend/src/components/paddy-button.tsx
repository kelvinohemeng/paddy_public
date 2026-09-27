import type { ComponentType } from "react";

import { PaddySpinnerIcon } from "@/components/paddy-icons";
import { cn } from "@/lib/utils";

// paddy button primitive.
// Spec: Figma Handoff → "Button" component set (239:142144), full
// 100-variant read 2026-09-27 via the Figma plugin API:
//   Style  Primary | Secondary | Danger | Transparent | Transparent Muted
//   Size   Small 28 | Base 32 | Large 36 | Xlarge 40
//   State  Default | Hover | Pressed | Focus | Disabled
// Radius is always 6px ("Rounded" is the only option in the set).
//
// Every value below is copied from the component, not approximated.
// The fills follow Tailwind's zinc (neutral) and rose (danger) scales,
// so the hex values here are the same ones Tailwind ships.
//
// The depth comes from box-shadows, not borders:
// - a 1px ring (0 0 0 1px) acts as the outline, so it never changes
//   the button's size;
// - Primary/Danger add a 0.75px white inner highlight at the top.
// Focus (keyboard only, :focus-visible) prepends a 2px white gap and
// a 4px blue ring (#3b82f6 at 60%) to the style's own shadow.
//
// Figma's "Pressed" state shows the Pressed fill with the label
// hidden and a spinner centered in its place, so it doubles as the
// loading state: `isLoading` renders exactly that. A plain :active
// press gets the Pressed fill only.

export type PaddyButtonStyle =
  | "primary"
  | "secondary"
  | "transparent"
  | "transparent-muted"
  | "danger";

export type PaddyButtonSize = "sm" | "base" | "lg" | "xl";

// Shadow stacks (Tailwind arbitrary values use _ for spaces).
const SHADOW = {
  primary:
    "shadow-[0_0_0_1px_#18181b,0_1px_2px_0_rgb(0_0_0/0.4),inset_0_0.75px_0_0_rgb(255_255_255/0.2)]",
  danger:
    "shadow-[0_0_0_1px_#be123c,0_1px_2px_0_rgb(190_18_60/0.4),inset_0_0.75px_0_0_rgb(255_255_255/0.2)]",
  secondary:
    "shadow-[0_0_0_1px_rgb(0_0_0/0.08),0_1px_2px_0_rgb(0_0_0/0.12)]",
};
const FOCUS = {
  primary:
    "focus-visible:shadow-[0_0_0_4px_rgb(59_130_246/0.6),0_0_0_2px_#fff,0_0_0_1px_#18181b,0_1px_2px_0_rgb(0_0_0/0.4),inset_0_0.75px_0_0_rgb(255_255_255/0.2)]",
  danger:
    "focus-visible:shadow-[0_0_0_4px_rgb(59_130_246/0.6),0_0_0_2px_#fff,0_0_0_1px_#be123c,0_1px_2px_0_rgb(190_18_60/0.4),inset_0_0.75px_0_0_rgb(255_255_255/0.2)]",
  // Secondary and both Transparent styles share one focus look: white
  // fill + the secondary outline + the ring.
  neutral:
    "focus-visible:bg-white focus-visible:shadow-[0_0_0_4px_rgb(59_130_246/0.6),0_0_0_2px_#fff,0_0_0_1px_rgb(0_0_0/0.08),0_1px_2px_0_rgb(0_0_0/0.12)]",
};

const STYLE_CLASSES: Record<PaddyButtonStyle, string> = {
  // #27272a → hover #3f3f46 → pressed #52525b; label white at 88%.
  primary: cn(
    "bg-[#27272a] text-white/[0.88] hover:bg-[#3f3f46] active:bg-[#52525b] data-[loading]:bg-[#52525b]",
    SHADOW.primary,
    FOCUS.primary,
  ),
  // #e11d48 → hover #be123c → pressed #9f1239; label solid white.
  danger: cn(
    "bg-[#e11d48] text-white hover:bg-[#be123c] active:bg-[#9f1239] data-[loading]:bg-[#9f1239]",
    SHADOW.danger,
    FOCUS.danger,
  ),
  // White → hover #f4f4f5 → pressed #e4e4e7; label #18181b.
  secondary: cn(
    "bg-white text-[#18181b] hover:bg-[#f4f4f5] active:bg-[#e4e4e7] data-[loading]:bg-[#e4e4e7]",
    SHADOW.secondary,
    FOCUS.neutral,
  ),
  // No fill or shadow until hover; same hover/pressed ramp as Secondary.
  transparent: cn(
    "bg-transparent text-[#18181b] hover:bg-[#f4f4f5] active:bg-[#e4e4e7] data-[loading]:bg-[#e4e4e7]",
    FOCUS.neutral,
  ),
  // As Transparent, with the muted zinc-500 label.
  "transparent-muted": cn(
    "bg-transparent text-[#71717a] hover:bg-[#f4f4f5] active:bg-[#e4e4e7] data-[loading]:bg-[#e4e4e7]",
    FOCUS.neutral,
  ),
};

// Padding is the set's (vertical, horizontal); height is fixed so an
// icon-only or empty button keeps the row height.
const SIZE_CLASSES: Record<PaddyButtonSize, string> = {
  sm: "h-7 px-2 py-1 text-[13px]",
  base: "h-8 px-2.5 py-1.5 text-[13px]",
  lg: "h-9 px-3 py-2 text-sm",
  xl: "h-10 px-4 py-2.5 text-sm",
};

// Disabled differs by family: the filled styles become a flat grey
// chip with a #e4e4e7 outline; the transparent styles keep no fill but
// pick up the secondary outline. Label #a1a1aa everywhere.
const DISABLED: Record<PaddyButtonStyle, string> = {
  primary:
    "disabled:bg-[#f4f4f5] disabled:text-[#a1a1aa] disabled:shadow-[0_0_0_1px_#e4e4e7]",
  secondary:
    "disabled:bg-[#f4f4f5] disabled:text-[#a1a1aa] disabled:shadow-[0_0_0_1px_#e4e4e7]",
  danger:
    "disabled:bg-[#f4f4f5] disabled:text-[#a1a1aa] disabled:shadow-[0_0_0_1px_#e4e4e7]",
  // Written out in full (not built from SHADOW.secondary): Tailwind
  // only generates classes it can find literally in the source.
  transparent:
    "disabled:bg-transparent disabled:text-[#a1a1aa] disabled:shadow-[0_0_0_1px_rgb(0_0_0/0.08),0_1px_2px_0_rgb(0_0_0/0.12)]",
  "transparent-muted":
    "disabled:bg-transparent disabled:text-[#a1a1aa] disabled:shadow-[0_0_0_1px_rgb(0_0_0/0.08),0_1px_2px_0_rgb(0_0_0/0.12)]",
};

type IconComponent = ComponentType<{ className?: string }>;

export function PaddyButton({
  variant = "primary",
  size = "base",
  leftIcon: LeftIcon,
  rightIcon: RightIcon,
  isLoading = false,
  disabled = false,
  type = "button",
  onClick,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "onClick"> & {
  variant?: PaddyButtonStyle;
  size?: PaddyButtonSize;
  /** Figma "IconSlot - Left" (15px). Any component taking className. */
  leftIcon?: IconComponent;
  /** Figma "Icon Slot - Right" (15px). */
  rightIcon?: IconComponent;
  /** Figma Pressed state: spinner over a hidden label, clicks ignored. */
  isLoading?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type={type}
      data-style={variant}
      data-loading={isLoading || undefined}
      disabled={disabled}
      aria-busy={isLoading || undefined}
      onClick={(e) => {
        // Loading keeps focus and the Pressed look but swallows clicks
        // (not `disabled`, which would drop focus and grey it out).
        if (isLoading) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md leading-5 font-medium whitespace-nowrap outline-none transition-[background-color,box-shadow,color] select-none",
        "disabled:pointer-events-none data-[loading]:cursor-progress",
        STYLE_CLASSES[variant],
        SIZE_CLASSES[size],
        DISABLED[variant],
        className,
      )}
      {...props}
    >
      {/* Content stays in the layout while loading so the button never
          changes width mid-request. opacity-0 (Figma's own treatment),
          not `invisible`: visibility:hidden would also drop the label
          from the button's accessible name. */}
      <span
        className={cn(
          "inline-flex items-center gap-1.5",
          isLoading && "opacity-0",
        )}
      >
        {LeftIcon && <LeftIcon className="size-[15px] shrink-0" aria-hidden />}
        {children}
        {RightIcon && (
          <RightIcon className="size-[15px] shrink-0" aria-hidden />
        )}
      </span>
      {isLoading && (
        <PaddySpinnerIcon className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin" />
      )}
    </button>
  );
}
