"use client";

import type { ReactNode } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { PencilLine } from "lucide-react";

import { PaddyButton } from "@/components/paddy-button";
import { PaddyBadge } from "@/components/paddy-badge";
import { useApiList } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import { FileImage } from "./photos-section";
import { SectionHeading } from "./form-parts";
import {
  ADVANCE_LABELS,
  parseWktPoint,
  type ListingFormValues,
} from "./schema";

// Step 5 (Review): everything the landlord entered, grouped by step,
// each group with an "Edit" link straight back to its step. Read-only —
// the save buttons live in the stepper's action bar.

type Amenity = { id: number; name: string };

export function ReviewStep({
  files,
  existingPhotoUrls,
  onEditStep,
}: {
  files: File[];
  /** Edit mode: the photos already on the listing. */
  existingPhotoUrls: string[];
  onEditStep: (step: number) => void;
}) {
  const { control } = useFormContext<ListingFormValues>();
  const values = useWatch({ control }) as ListingFormValues;
  // Same query (and cache) as the AmenityPicker on step 1 — no extra
  // request, just the names for the ids the form holds.
  const { data: amenityData } = useApiList<Amenity>("core/amenities");
  const amenityNames = (values.amenities ?? [])
    .map((id) => amenityData?.data.find((a) => a.id === id)?.name)
    .filter((name): name is string => Boolean(name));

  const point = parseWktPoint(values.location);
  const isSale = values.listing_type === "buy";

  // Saved photos first (edit mode), then the ones waiting to upload — the
  // order they'll end up in. At most 8 thumbnails, then "+N".
  const THUMBS = 8;
  const photoCount = existingPhotoUrls.length + files.length;
  const savedShown = existingPhotoUrls.slice(0, THUMBS);
  const pickedShown = files.slice(0, Math.max(0, THUMBS - savedShown.length));
  const thumbClass = "bg-surface size-16 rounded-md object-cover";

  return (
    <div className="flex flex-col gap-6">
      <ReviewGroup title="Basics" onEdit={() => onEditStep(0)}>
        <ReviewItem label="Photos" wide>
          {photoCount === 0 ? (
            <span className="text-muted-foreground">
              No photos — listings with photos get far more interest.
            </span>
          ) : (
            <div className="flex flex-wrap gap-2">
              {savedShown.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={src} src={src} alt={`Photo ${i + 1}`} className={thumbClass} />
              ))}
              {pickedShown.map((file) => (
                <FileImage
                  key={`${file.name}-${file.size}-${file.lastModified}`}
                  file={file}
                  alt={file.name}
                  className={thumbClass}
                />
              ))}
              {photoCount > THUMBS && (
                <span className="bg-surface text-muted-foreground flex size-16 items-center justify-center rounded-md text-xs font-medium">
                  +{photoCount - THUMBS}
                </span>
              )}
            </div>
          )}
        </ReviewItem>
        <ReviewItem label="Title" wide>
          {values.title}
        </ReviewItem>
        <ReviewItem label="Description" wide>
          <span className="line-clamp-4 whitespace-pre-line">{values.description}</span>
        </ReviewItem>
        <ReviewItem label="Bedrooms">{values.bedrooms}</ReviewItem>
        <ReviewItem label="Bathrooms">{values.bathrooms}</ReviewItem>
        <ReviewItem label="Amenities" wide>
          {amenityNames.length === 0 ? (
            <span className="text-muted-foreground">None added</span>
          ) : (
            <span className="flex flex-wrap gap-1.5">
              {amenityNames.map((name) => (
                <PaddyBadge key={name} state="neutral" rounded>
                  {name}
                </PaddyBadge>
              ))}
            </span>
          )}
        </ReviewItem>
      </ReviewGroup>

      <ReviewGroup title="Location" onEdit={() => onEditStep(1)}>
        <ReviewItem label="Address" wide>
          {values.address_precise}
        </ReviewItem>
        <ReviewItem label="Neighbourhood">{values.neighborhood}</ReviewItem>
        <ReviewItem label="City">{values.city}</ReviewItem>
        <ReviewItem label="Map pin" wide>
          {point ? (
            <span className="tabular-nums">
              {point.lat.toFixed(6)}, {point.lng.toFixed(6)}
            </span>
          ) : (
            <span className="text-destructive">Not set</span>
          )}
        </ReviewItem>
      </ReviewGroup>

      <ReviewGroup title="Pricing & type" onEdit={() => onEditStep(2)}>
        {isSale ? (
          <ReviewItem label="Listing type" wide>
            For sale · GHS {Number(values.price_one_time ?? 0).toLocaleString()} (unchanged)
          </ReviewItem>
        ) : (
          <>
            <ReviewItem label="Monthly price">
              {values.price_monthly
                ? `GHS ${Number(values.price_monthly).toLocaleString()} / month`
                : "—"}
            </ReviewItem>
            <ReviewItem label="Advance rent period">
              {values.advance_rent_period
                ? ADVANCE_LABELS[values.advance_rent_period]
                : "—"}
            </ReviewItem>
          </>
        )}
      </ReviewGroup>

      <ReviewGroup title="Others" onEdit={() => onEditStep(3)}>
        <ReviewItem label="360° tour URL" wide>
          {values.virtual_tour_url ? (
            <span className="break-all">{values.virtual_tour_url}</span>
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
        </ReviewItem>
      </ReviewGroup>
    </div>
  );
}

function ReviewGroup({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <section className="border-hairline rounded-lg border p-4 md:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionHeading>{title}</SectionHeading>
        <PaddyButton
          variant="transparent"
          size="sm"
          leftIcon={PencilLine}
          onClick={onEdit}
          aria-label={`Edit ${title}`}
        >
          Edit
        </PaddyButton>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3">{children}</dl>
    </section>
  );
}

function ReviewItem({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", wide && "col-span-2")}>
      <dt className="text-subtle-foreground text-[13px] leading-5">{label}</dt>
      <dd className="text-foreground text-sm leading-5 break-words">{children}</dd>
    </div>
  );
}
