"use client";

import { useFormContext } from "react-hook-form";

import { FormRow, INPUT_CLASS, TEXTAREA_CLASS } from "./form-parts";
import type { ListingFieldName, ListingFormValues } from "./schema";

// Step 1 (Basics), after Photos: title, description, bedrooms and
// bathrooms — Figma 288:8254's order. Plain inputs registered straight
// on the shared form; the schema (schema.ts) holds every rule.

// The fields Next validates for this part of step 1.
export const BASICS_FIELDS = [
  "title",
  "description",
  "bedrooms",
  "bathrooms",
] as const satisfies readonly ListingFieldName[];

export function BasicsSection() {
  const { register } = useFormContext<ListingFormValues>();

  return (
    <div className="flex flex-col gap-8">
      <FormRow name="title" label="Title">
        {({ id, invalid, describedBy }) => (
          <input
            id={id}
            {...register("title")}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            placeholder="e.g. Cozy 2-bedroom apartment in East Legon"
            maxLength={200}
            className={INPUT_CLASS}
          />
        )}
      </FormRow>

      <FormRow name="description" label="Description">
        {({ id, invalid, describedBy }) => (
          <textarea
            id={id}
            {...register("description")}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            rows={4}
            placeholder="Light, ventilation, water storage, power backup, access road…"
            className={TEXTAREA_CLASS}
          />
        )}
      </FormRow>

      <div className="grid grid-cols-2 gap-4 md:gap-8">
        <FormRow name="bedrooms" label="Bedrooms">
          {({ id, invalid, describedBy }) => (
            <input
              id={id}
              {...register("bedrooms")}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              type="number"
              inputMode="numeric"
              min={0}
              max={99}
              step={1}
              placeholder="2"
              className={INPUT_CLASS}
            />
          )}
        </FormRow>
        <FormRow name="bathrooms" label="Bathrooms">
          {({ id, invalid, describedBy }) => (
            <input
              id={id}
              {...register("bathrooms")}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              type="number"
              inputMode="numeric"
              min={0}
              max={99}
              step={1}
              placeholder="1"
              className={INPUT_CLASS}
            />
          )}
        </FormRow>
      </div>
    </div>
  );
}
