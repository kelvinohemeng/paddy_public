"use client";

import { Controller, useFormContext, useWatch } from "react-hook-form";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormRow, INPUT_CLASS, SELECT_TRIGGER_CLASS } from "./form-parts";
import {
  ADVANCE_LABELS,
  OFFERED_ADVANCE_PERIODS,
  type ListingFieldName,
  type ListingFormValues,
} from "./schema";

// Step 3 (Pricing & type). Figma 288:8254 shows Listing Type, Monthly
// Price and Advance Rent Period. Kelvin (2026-09-28): paddy is rent-only
// with a 6-month or 1-year advance, so there's no Listing Type picker
// (every new listing is sent as "rent") and the "None / no advance"
// option is gone. The backend still allows both, and this form must not
// quietly rewrite an older listing that uses them — so for those, the
// stored value shows read-only with a note, and goes back unchanged.

export const PRICING_FIELDS = [
  "price_monthly",
  "advance_rent_period",
] as const satisfies readonly ListingFieldName[];

function formatGhs(amount: string | null): string {
  if (!amount) return "—";
  const n = Number(amount);
  return Number.isFinite(n) ? `GHS ${n.toLocaleString()}` : `GHS ${amount}`;
}

export function PricingSection() {
  const { control, register } = useFormContext<ListingFormValues>();
  const listingType = useWatch({ control, name: "listing_type" });
  const advance = useWatch({ control, name: "advance_rent_period" });
  const priceOneTime = useWatch({ control, name: "price_one_time" });

  // Edit edge case 1: an older sale listing. Nothing here is editable;
  // the stored type and one-time price are sent back as they are.
  if (listingType === "buy") {
    return (
      <LegacyNote title="This is a sale listing">
        <p>
          Listing type: <strong>For sale</strong> · One-time price:{" "}
          <strong>{formatGhs(priceOneTime)}</strong>
        </p>
        <p>
          New listings on paddy are rentals only. This one keeps its type and
          price exactly as they are.
        </p>
      </LegacyNote>
    );
  }

  return (
    <div className="flex flex-col gap-[26px]">
      <FormRow name="price_monthly" label="Monthly price (GHS)">
        {({ id, invalid, describedBy }) => (
          <input
            id={id}
            {...register("price_monthly")}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            // Kept as a string: DRF's DecimalField takes "2500.00" as-is,
            // so money never goes through JS floating point.
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            placeholder="e.g. 2500"
            className={INPUT_CLASS}
          />
        )}
      </FormRow>

      {/* Edit edge case 2: an older rental with no advance period. */}
      {advance === "none" ? (
        <FormRow label="Advance rent period">
          {() => (
            <LegacyNote title={ADVANCE_LABELS.none}>
              <p>
                New listings ask for 6 months or 1 year upfront. This one keeps
                its original setting.
              </p>
            </LegacyNote>
          )}
        </FormRow>
      ) : (
        <FormRow
          name="advance_rent_period"
          label="Advance rent period"
          tooltip="How much rent the tenant pays upfront before moving in."
        >
          {({ id, invalid, describedBy }) => (
            <Controller
              control={control}
              name="advance_rent_period"
              render={({ field }) => (
                <Select
                  // Radix Select shows its placeholder for `undefined`,
                  // never for "" (not a valid item value).
                  value={field.value || undefined}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger
                    id={id}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    aria-invalid={invalid || undefined}
                    aria-describedby={describedBy}
                    className={SELECT_TRIGGER_CLASS}
                  >
                    <SelectValue placeholder="Choose 6 months or 1 year" />
                  </SelectTrigger>
                  <SelectContent>
                    {OFFERED_ADVANCE_PERIODS.map((period) => (
                      <SelectItem key={period} value={period} className="text-base">
                        {ADVANCE_LABELS[period]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          )}
        </FormRow>
      )}
    </div>
  );
}

// A read-only box for a stored value this form no longer offers.
function LegacyNote({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-field text-subtle-foreground flex flex-col gap-1 rounded-lg px-4 py-3 text-[13px] leading-5 shadow-[0_0_0_1px_rgb(0_0_0/0.08)]">
      <p className="text-foreground text-base font-medium">{title}</p>
      {children}
    </div>
  );
}
