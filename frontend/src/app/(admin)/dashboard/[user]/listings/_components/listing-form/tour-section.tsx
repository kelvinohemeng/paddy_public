"use client";

import { useFormContext } from "react-hook-form";

import { FormRow, INPUT_CLASS } from "./form-parts";
import type { ListingFieldName, ListingFormValues } from "./schema";

// Step 4 (Others): only the 360° tour link. Figma 288:8254 repeats
// Monthly Price and Advance Rent Period under "Others" — a copy-paste
// slip (Kelvin, 2026-09-28), so they're not here. Optional: the
// photosphere is often shot after a listing is first created.

export const TOUR_FIELDS = ["virtual_tour_url"] as const satisfies readonly ListingFieldName[];

export function TourSection() {
  const { register } = useFormContext<ListingFormValues>();

  return (
    <FormRow
      name="virtual_tour_url"
      label="360° tour URL"
      optional
      tooltip="A link to the home's photosphere tour. You can add it later."
    >
      {({ id, invalid, describedBy }) => (
        <input
          id={id}
          {...register("virtual_tour_url")}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          type="url"
          inputMode="url"
          placeholder="https://…"
          maxLength={200}
          className={INPUT_CLASS}
        />
      )}
    </FormRow>
  );
}
