"use client";

import { useId, type ReactNode } from "react";
import { useFormContext, useFormState } from "react-hook-form";

import { PaddyLabel, type PaddyLabelType } from "@/components/paddy-label";
import { cn } from "@/lib/utils";
import type { ListingFieldName, ListingFormValues } from "./schema";

// Shared building blocks for the listing form's sections, drawn from
// Figma frame 288:8254 ("Listing Creation form") and the components it
// uses (read 2026-09-28):
//
// Input Field (21:24953, Size 3): 56px tall, white, 1px #e2e2e2 stroke,
//   radius 8, 16px padding, text Inter 16/24, placeholder #757575.
//   State=Active: 2px black stroke. There's no Error state in the set, so
//   errors borrow the Select set's (1px #e11d48 + 3px halo at 15%).
// Single / Multi Select (20:23057, bg-field): #fafafa fill, radius 6, the
//   Secondary button's ring shadow, hover #f4f4f5, focus 1px #3b82f6 +
//   4px halo at 20%. The form stretches it to the Input Field's 56px.
// Sections: Clash Display Medium 22, black at 80%, -2% tracking; 32px
//   between fields, 10px from a label to its control, 32px between side-
//   by-side fields.
//
// Every value maps to a token in globals.css (field, field-border,
// field-placeholder, subtle-foreground, ring, destructive…).

export const INPUT_CLASS = cn(
  "border-field-border text-foreground placeholder:text-field-placeholder flex h-14 w-full min-w-0 rounded-lg border bg-white px-4 text-base leading-6 outline-none transition-[border-color,box-shadow]",
  // Active: a 1px border plus a 1px ring outside it reads as Figma's 2px
  // stroke, without the box growing and nudging the layout.
  "focus-visible:border-black focus-visible:ring-1 focus-visible:ring-black",
  "aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/15",
  "disabled:bg-muted disabled:text-disabled-foreground disabled:cursor-not-allowed",
);

export const TEXTAREA_CLASS = cn(
  INPUT_CLASS,
  "h-auto min-h-32 resize-y py-4 field-sizing-content",
);

export const SELECT_TRIGGER_CLASS = cn(
  "bg-field text-foreground data-[placeholder]:text-muted-foreground w-full rounded-md border-0 px-4 text-base leading-5 data-[size=default]:h-14",
  "shadow-[0_0_0_1px_rgb(0_0_0/0.08),0_1px_2px_0_rgb(0_0_0/0.12)] hover:bg-muted",
  "focus-visible:bg-muted focus-visible:ring-0 focus-visible:shadow-[0_0_0_1px_var(--ring),0_0_0_4px_color-mix(in_srgb,var(--ring)_20%,transparent)]",
  "aria-invalid:shadow-[0_0_0_1px_var(--destructive),0_0_0_3px_color-mix(in_srgb,var(--destructive)_15%,transparent)] aria-invalid:ring-0",
);

// Figma section title ("Basics", "Location", "Pricing & Type", "Others").
export function SectionHeading({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3
      id={id}
      className="font-display text-[22px] leading-tight font-medium tracking-[-0.02em] text-black/80"
    >
      {children}
    </h3>
  );
}

// One labelled field: PaddyLabel, an optional description line, the
// control, then its validation message. The control is a render prop so
// it gets the id and aria wiring (label → input, input → message) without
// each section repeating it.
export function FormRow({
  name,
  label,
  labelType = "subtle",
  optional,
  tooltip,
  description,
  className,
  children,
}: {
  /** The form field this row validates; its error shows under the control. */
  name?: ListingFieldName;
  label: ReactNode;
  labelType?: PaddyLabelType;
  optional?: boolean;
  tooltip?: ReactNode;
  description?: ReactNode;
  className?: string;
  children: (control: {
    id: string;
    invalid: boolean;
    describedBy: string | undefined;
  }) => ReactNode;
}) {
  const id = useId();
  const { control } = useFormContext<ListingFormValues>();
  // Subscribes to just this field's error, so a keystroke elsewhere in
  // the form doesn't re-render every row.
  const { errors } = useFormState({ control, name: name ?? [] });
  const error = name ? errors[name] : undefined;
  const messageId = `${id}-message`;
  const descriptionId = `${id}-description`;
  const describedBy =
    [description ? descriptionId : null, error ? messageId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className={cn("flex min-w-0 flex-col gap-2.5", className)}>
      <div className="flex flex-col gap-1">
        <PaddyLabel htmlFor={id} type={labelType} optional={optional} tooltip={tooltip}>
          {label}
        </PaddyLabel>
        {description && (
          <p id={descriptionId} className="text-subtle-foreground text-[13px] leading-[1.6]">
            {description}
          </p>
        )}
      </div>
      {children({ id, invalid: Boolean(error), describedBy })}
      {error?.message && (
        <p id={messageId} role="alert" className="text-destructive text-[13px] leading-5">
          {String(error.message)}
        </p>
      )}
    </div>
  );
}
