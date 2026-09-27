import type { ComponentType } from "react";

import { cn } from "@/lib/utils";

// paddy badge primitive.
// Spec: Figma Handoff → "Badge" component set (239:141854), 72
// variants read 2026-09-27:
//   Size   2xsmall 20 | Xsmall 24
//   State  Neutral | Information | Feature | Success | Warning | Error
//   Radius Default (6px) | Rounded (pill)
//   Type   Base | Left Icon | Right Icon
//
// Colors are Tailwind's own palettes — fill 100, border 200, label
// 800, icon 500 — on zinc / blue / violet / emerald / orange / rose.
// Label is Inter Medium 12/20; the 1px border sits inside the box.
//
// This is paddy's status chip (Leased, Active, Pending review…). The
// shadcn `ui/badge` stays as-is for the places that still use it.

export type PaddyBadgeState =
  | "neutral"
  | "information"
  | "feature"
  | "success"
  | "warning"
  | "error";

export type PaddyBadgeSize = "2xs" | "xs";

const STATE_CLASSES: Record<PaddyBadgeState, { box: string; icon: string }> =
  {
    neutral: {
      box: "bg-[#f4f4f5] border-[#e4e4e7] text-[#52525b]",
      icon: "text-[#71717a]",
    },
    information: {
      box: "bg-[#dbeafe] border-[#bfdbfe] text-[#1e40af]",
      icon: "text-[#3b82f6]",
    },
    feature: {
      box: "bg-[#ede9fe] border-[#ddd6fe] text-[#5b21b6]",
      icon: "text-[#8b5cf6]",
    },
    success: {
      box: "bg-[#d1fae5] border-[#a7f3d0] text-[#065f46]",
      icon: "text-[#10b981]",
    },
    warning: {
      box: "bg-[#ffedd5] border-[#fed7aa] text-[#9a3412]",
      icon: "text-[#f97316]",
    },
    error: {
      box: "bg-[#ffe4e6] border-[#fecdd3] text-[#9f1239]",
      icon: "text-[#f43f5e]",
    },
  };

// Horizontal padding from the set. The side that holds an icon is
// always 1px tighter than the text side (e.g. Xsmall/Default/Left Icon
// is 5px left, 6px right). Rounded badges get 2px more each side.
const PADDING = {
  "2xs": {
    default: { base: "px-1", left: "pl-[3px] pr-1", right: "pl-1 pr-[3px]" },
    rounded: { base: "px-1.5", left: "pl-[5px] pr-1.5", right: "pl-1.5 pr-[5px]" },
  },
  xs: {
    default: { base: "px-1.5", left: "pl-[5px] pr-1.5", right: "pl-1.5 pr-[5px]" },
    rounded: { base: "px-2", left: "pl-[7px] pr-2", right: "pl-2 pr-[7px]" },
  },
} as const;

type IconComponent = ComponentType<{ className?: string }>;

export function PaddyBadge({
  state = "neutral",
  size = "xs",
  rounded = false,
  leftIcon: LeftIcon,
  rightIcon: RightIcon,
  children,
  className,
  ...props
}: React.ComponentProps<"span"> & {
  state?: PaddyBadgeState;
  size?: PaddyBadgeSize;
  /** Figma Radius=Rounded (full pill). Default is 6px corners. */
  rounded?: boolean;
  /** Figma Type=Left Icon — 15px glyph tinted with the state's 500. */
  leftIcon?: IconComponent;
  /** Figma Type=Right Icon. */
  rightIcon?: IconComponent;
}) {
  const colors = STATE_CLASSES[state];
  const type = LeftIcon ? "left" : RightIcon ? "right" : "base";
  return (
    <span
      data-slot="paddy-badge"
      data-state={state}
      className={cn(
        "inline-flex w-fit shrink-0 items-center justify-center gap-[3px] border text-xs leading-5 font-medium whitespace-nowrap",
        size === "2xs" ? "h-5" : "h-6",
        rounded ? "rounded-full" : "rounded-md",
        PADDING[size][rounded ? "rounded" : "default"][type],
        colors.box,
        className,
      )}
      {...props}
    >
      {LeftIcon && (
        <LeftIcon className={cn("size-[15px] shrink-0", colors.icon)} aria-hidden />
      )}
      {children}
      {RightIcon && (
        <RightIcon className={cn("size-[15px] shrink-0", colors.icon)} aria-hidden />
      )}
    </span>
  );
}
