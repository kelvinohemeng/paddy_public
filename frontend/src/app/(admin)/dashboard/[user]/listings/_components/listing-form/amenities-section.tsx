"use client";

import { Controller, useFormContext } from "react-hook-form";

import { AmenityPicker } from "../amenity-picker";
import { FormRow } from "./form-parts";
import type { ListingFieldName, ListingFormValues } from "./schema";

// Step 1 (Basics), last: amenities. Figma 288:8254 shows a single-select
// dropdown reading "Rent" here — a copy-paste slip (Kelvin, 2026-09-28).
// This is the existing searchable multi-select with removable chips
// (amenity-picker.tsx), with its trigger styled as Figma's 56px bg-field
// select so it sits in line with the other fields.

export const AMENITY_FIELDS = ["amenities"] as const satisfies readonly ListingFieldName[];

export function AmenitiesSection() {
  const { control } = useFormContext<ListingFormValues>();

  return (
    <FormRow name="amenities" label="Amenities" optional>
      {({ id }) => (
        <Controller
          control={control}
          name="amenities"
          // AmenityPicker is a custom component with its own value/onChange
          // shape (an array of Amenity ids), not a native input, so it
          // can't be spread via register() — Controller is react-hook-
          // form's bridge for exactly this. "amenities" is
          // ListingSerializer's own field name (a list of Amenity pks).
          render={({ field }) => (
            <AmenityPicker
              id={id}
              value={field.value ?? []}
              onChange={field.onChange}
              triggerClassName="bg-field hover:bg-muted h-14 rounded-md border-0 px-4 has-[>svg]:px-4 text-base shadow-[0_0_0_1px_rgb(0_0_0/0.08),0_1px_2px_0_rgb(0_0_0/0.12)]"
            />
          )}
        />
      )}
    </FormRow>
  );
}
