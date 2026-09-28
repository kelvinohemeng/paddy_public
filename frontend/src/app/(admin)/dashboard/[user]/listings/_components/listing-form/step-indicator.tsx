"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

// The row of steps at the top of the listing form. Figma has no stepper
// (frame 288:8254 is one long form; the stepper is Kelvin's 2026-09-28
// call), so this is built from the design language around it: the
// near-black primary (#27272a, PaddyButton Primary) for done and current
// steps, zinc muted for steps ahead, Inter Medium 13 labels like the
// form's Labels.
//
// Phones get a compact "Step 2 of 5 · Location" line over a 5-segment
// bar instead — five labelled circles don't fit 375px.
//
// A step is a button only when `canVisit` says so: in create mode, the
// steps already reached; in edit mode, all of them. The stepper decides
// (and validates on the way when jumping forward).

export type StepItem = { label: string };

export function StepIndicator({
  steps,
  current,
  canVisit,
  onSelect,
}: {
  steps: StepItem[];
  current: number;
  canVisit: (index: number) => boolean;
  onSelect: (index: number) => void;
}) {
  return (
    <nav aria-label="Listing form steps">
      {/* Phones */}
      <div className="flex flex-col gap-2 md:hidden">
        <p className="text-[13px] leading-5">
          <span className="text-muted-foreground">
            Step {current + 1} of {steps.length} ·{" "}
          </span>
          <span className="text-foreground font-medium">{steps[current].label}</span>
        </p>
        <ol className="flex gap-1">
          {steps.map((step, i) => (
            <li key={step.label} className="flex-1">
              <button
                type="button"
                disabled={!canVisit(i) || i === current}
                onClick={() => onSelect(i)}
                aria-label={`Step ${i + 1}: ${step.label}`}
                aria-current={i === current ? "step" : undefined}
                className={cn(
                  "block h-1.5 w-full rounded-full transition-colors disabled:cursor-default",
                  i <= current ? "bg-primary" : "bg-muted",
                )}
              />
            </li>
          ))}
        </ol>
      </div>

      {/* md and up */}
      <ol className="hidden items-center gap-2 md:flex">
        {steps.map((step, i) => {
          const done = i < current;
          const isCurrent = i === current;
          const clickable = canVisit(i) && !isCurrent;
          return (
            <li
              key={step.label}
              className={cn("flex items-center gap-2", i < steps.length - 1 && "flex-1")}
            >
              <button
                type="button"
                disabled={!clickable}
                onClick={() => onSelect(i)}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "group flex shrink-0 items-center gap-2 rounded-md outline-none disabled:cursor-default",
                  "focus-visible:shadow-[0_0_0_2px_#fff,0_0_0_4px_color-mix(in_srgb,var(--ring)_60%,transparent)]",
                )}
              >
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-xs font-medium transition-colors",
                    done || isCurrent
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                    isCurrent && "shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_15%,transparent)]",
                    clickable && !done && "group-hover:bg-border",
                  )}
                >
                  {done ? <Check className="size-3.5" strokeWidth={2.5} aria-hidden /> : i + 1}
                </span>
                <span
                  className={cn(
                    "text-[13px] leading-5 font-medium whitespace-nowrap",
                    isCurrent ? "text-foreground" : "text-muted-foreground",
                    clickable && "group-hover:text-foreground",
                  )}
                >
                  {step.label}
                  {done && <span className="sr-only"> (done)</span>}
                </span>
              </button>
              {i < steps.length - 1 && (
                <span
                  aria-hidden
                  className={cn("h-px min-w-3 flex-1", done ? "bg-primary" : "bg-border")}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
