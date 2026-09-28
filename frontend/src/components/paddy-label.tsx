"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { InformationCircleSolidIcon } from "@/components/paddy-icons";
import { cn } from "@/lib/utils";

// paddy form-field label.
// Spec: Figma components page → "Label" component set (289:168764,
// the same shape as the older 18:678 the listing form's instances
// point at), read 2026-09-28:
//   Type           Plus | Subtle
//   Show Optional  boolean — a trailing "(Optional)"
//   Show Tooltip   boolean — a trailing 15px info-circle-solid
//
//   Plus    label Inter Medium 13/20  #18181b (--foreground)
//   Subtle  label Inter Regular 13/20 #52525b (--color-subtle-foreground)
//   "(Optional)" Inter Regular 13/20 #71717a (--muted-foreground), both
//   info icon #71717a; 4px between each part.
//
// This is NOT the status chip — that's PaddyBadge. The listing form uses
// Subtle for its field labels and Plus where a label heads a bigger block
// (the map). The shadcn `ui/label` stays for the older forms.
//
// Accessibility: the text and "(Optional)" sit inside the real <label>, so
// a screen reader hears "Title (Optional)". The info icon is a separate
// focusable button OUTSIDE the <label> — a button inside a label would
// also toggle the labelled control when clicked.

export type PaddyLabelType = "plus" | "subtle";

export function PaddyLabel({
  type = "subtle",
  optional = false,
  tooltip,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<"label">, "type"> & {
  /** Figma Type. Plus = darker, medium weight. */
  type?: PaddyLabelType;
  /** Figma "Show Optional". */
  optional?: boolean;
  /** Figma "Show Tooltip" — the icon shows when this is set, and the
   *  content is what the tooltip says. */
  tooltip?: React.ReactNode;
}) {
  return (
    <div
      data-slot="paddy-label"
      data-type={type}
      className={cn("flex min-h-5 items-center gap-1", className)}
    >
      <label
        className={cn(
          "inline-flex items-center gap-1 text-[13px] leading-5",
          type === "plus"
            ? "text-foreground font-medium"
            : "text-subtle-foreground font-normal",
        )}
        {...props}
      >
        {children}
        {optional && (
          <span className="text-muted-foreground font-normal">(Optional)</span>
        )}
      </label>
      {tooltip && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="More information"
              className="text-muted-foreground inline-flex size-[15px] shrink-0 cursor-help items-center justify-center rounded-full outline-none focus-visible:shadow-[0_0_0_2px_#fff,0_0_0_4px_rgb(59_130_246/0.6)]"
            >
              <InformationCircleSolidIcon />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{tooltip}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
