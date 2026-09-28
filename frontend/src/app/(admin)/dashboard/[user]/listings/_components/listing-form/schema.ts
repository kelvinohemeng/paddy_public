import { z } from "zod";

// ONE schema for the whole listing form. Every step's section component
// reads and writes the same react-hook-form instance (via FormProvider),
// and this schema validates it through zodResolver. Each section exports
// the field names it owns (e.g. BASICS_FIELDS), so the stepper's Next
// button can run form.trigger(thoseFields) and validate just that step.
//
// Field names are the backend's own (ListingSerializer / Listing model in
// backend/listings/models.py), so the payload maps 1:1. The limits below
// are the model's: CharField max_lengths, DecimalField(max_digits=10,
// decimal_places=2), URLField (200 chars).
//
// Number fields (bedrooms, bathrooms, price) are kept as STRINGS while
// editing — that's what an <input> gives back, and it lets "" mean
// "not filled in yet" instead of a surprise 0. toPayload() converts them
// once, at save time. Prices stay strings all the way: DRF's DecimalField
// accepts "2500.00" as-is, which avoids JS floating-point rounding on
// money.

// Only rent listings with a 6-month or 1-year advance are offered
// (Kelvin, 2026-09-28). "buy" and "none" are still valid backend values,
// so the schema accepts them — but only a pre-existing listing can carry
// them into the form (the edit edge case in PricingSection).
export const LISTING_TYPES = ["rent", "buy"] as const;
export const ADVANCE_PERIODS = ["6_months", "1_year", "none"] as const;
export const OFFERED_ADVANCE_PERIODS = ["6_months", "1_year"] as const;

export const ADVANCE_LABELS: Record<(typeof ADVANCE_PERIODS)[number], string> = {
  "6_months": "6 months",
  "1_year": "1 year",
  none: "None (no advance)",
};

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// The exact WKT string LocationSection builds: "SRID=4326;POINT (lng lat)".
// Longitude first — GeoDjango's Point(x, y) order.
const WKT_POINT = /^SRID=4326;POINT \((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$/;

export function parseWktPoint(wkt: string | null | undefined): { lat: number; lng: number } | null {
  if (!wkt) return null;
  // Tolerant of the serializer's own spacing (it may omit "SRID=…;").
  const match = wkt.match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);
  if (!match) return null;
  return { lng: Number(match[1]), lat: Number(match[2]) };
}

export function toWktPoint(lat: number, lng: number): string {
  return `SRID=4326;POINT (${lng} ${lat})`;
}

export const listingFormSchema = z
  .object({
    // --- Step 1: Basics ---
    title: z
      .string()
      .trim()
      .min(1, "Give your listing a title.")
      .max(200, "Keep the title under 200 characters."),
    description: z
      .string()
      .trim()
      .min(1, "Describe the home: rooms, light, water, power backup, access."),
    bedrooms: z
      .string()
      .regex(/^\d{1,2}$/, "Enter the number of bedrooms (0 for a studio)."),
    bathrooms: z.string().regex(/^\d{1,2}$/, "Enter the number of bathrooms."),
    // Amenity ids from the shared core.Amenity table (AmenityPicker).
    amenities: z.array(z.number()),

    // --- Step 2: Location ---
    address_precise: z
      .string()
      .trim()
      .min(1, "Enter the address.")
      .max(255, "Keep the address under 255 characters."),
    // Required (Kelvin, 2026-09-28): the Discovery Hub is map-driven, so a
    // listing without coordinates would never show on it. Set by picking
    // an address suggestion, clicking or dragging the map pin, or pasting
    // coordinates — pasting works even when Google Maps fails to load.
    location: z
      .string()
      .nullable()
      .refine((v) => v !== null && WKT_POINT.test(v), {
        message:
          "Set the exact spot: pick an address suggestion, click the map, or paste coordinates.",
      }),
    neighborhood: z
      .string()
      .trim()
      .min(1, "Enter the neighbourhood.")
      .max(100, "Keep the neighbourhood under 100 characters."),
    city: z
      .string()
      .trim()
      .min(1, "Enter the city.")
      .max(100, "Keep the city under 100 characters."),

    // --- Step 3: Pricing & type ---
    // Always "rent" for new listings; see LISTING_TYPES above.
    listing_type: z.enum(LISTING_TYPES),
    price_monthly: z.string(),
    // Never edited here — only carried through unchanged for an older
    // "buy" listing (edit edge case).
    price_one_time: z.string().nullable(),
    // "" = not chosen yet; the refinement below turns that into an error.
    advance_rent_period: z.union([z.enum(ADVANCE_PERIODS), z.literal("")]),

    // --- Step 4: Others ---
    virtual_tour_url: z
      .string()
      .trim()
      .max(200, "Keep the link under 200 characters.")
      .refine((v) => v === "" || isHttpUrl(v), {
        message: "Enter a full link starting with https://, or leave it empty.",
      }),
  })
  .superRefine((values, ctx) => {
    // Pricing rules depend on the listing type (Listing.clean() in the
    // backend keeps one price per type). A rent listing needs a monthly
    // price and an advance period; an older "buy" listing keeps its
    // one-time price untouched and skips both.
    if (values.listing_type !== "rent") return;

    const price = values.price_monthly.trim();
    if (!price) {
      ctx.addIssue({
        code: "custom",
        path: ["price_monthly"],
        message: "Enter the monthly rent in GHS.",
      });
    } else if (!/^\d{1,8}(\.\d{1,2})?$/.test(price) || Number(price) <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["price_monthly"],
        message: "Enter an amount like 2500 or 2500.50.",
      });
    }

    if (values.advance_rent_period === "") {
      ctx.addIssue({
        code: "custom",
        path: ["advance_rent_period"],
        message: "Choose 6 months or 1 year.",
      });
    }
  });

// What the inputs hold while editing, and what zodResolver hands to
// handleSubmit (same shape — the only transform is trimming).
export type ListingFormValues = z.input<typeof listingFormSchema>;
export type ListingFormOutput = z.output<typeof listingFormSchema>;
export type ListingFieldName = keyof ListingFormValues;

export const EMPTY_LISTING_FORM: ListingFormValues = {
  title: "",
  description: "",
  bedrooms: "",
  bathrooms: "",
  amenities: [],
  address_precise: "",
  location: null,
  neighborhood: "",
  city: "",
  listing_type: "rent",
  price_monthly: "",
  price_one_time: null,
  advance_rent_period: "",
  virtual_tour_url: "",
};

// Existing listing (GET /listings/<id>/, owner view) → form values. Only
// the editable fields are copied: the PUT then sends exactly these, and
// read-only serializer fields (status, slug, photos…) never ride along.
// `record` is the API's untyped JSON (useApiOne returns any).
export function listingToFormValues(record: any): ListingFormValues {
  const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const listingType = LISTING_TYPES.includes(record?.listing_type)
    ? (record.listing_type as ListingFormValues["listing_type"])
    : "rent";
  const advance = ADVANCE_PERIODS.includes(record?.advance_rent_period)
    ? (record.advance_rent_period as ListingFormValues["advance_rent_period"])
    : "";
  return {
    title: str(record?.title),
    description: str(record?.description),
    bedrooms: str(record?.bedrooms),
    bathrooms: str(record?.bathrooms),
    amenities: Array.isArray(record?.amenities)
      ? record.amenities.map(Number).filter((n: number) => Number.isFinite(n))
      : [],
    address_precise: str(record?.address_precise),
    // The owner gets the exact point back; rebuild it in the one format
    // the schema checks, whatever spacing the serializer used.
    location: (() => {
      const point = parseWktPoint(record?.location);
      return point ? toWktPoint(point.lat, point.lng) : null;
    })(),
    neighborhood: str(record?.neighborhood),
    city: str(record?.city),
    listing_type: listingType,
    price_monthly: str(record?.price_monthly),
    price_one_time:
      record?.price_one_time === null || record?.price_one_time === undefined
        ? null
        : String(record.price_one_time),
    advance_rent_period: advance,
    virtual_tour_url: str(record?.virtual_tour_url),
  };
}

// Validated form values → the JSON body for POST /listings/ or
// PUT /listings/<id>/.
//
// listing_type, price_one_time and a stored "none" advance period go back
// exactly as they came in: a new listing is always "rent" (the form's
// default), and an older "buy"/"none" listing is shown read-only and must
// not be silently rewritten (decision 6). The price that doesn't apply to
// the listing's type is sent as null, matching Listing.clean().
export function toPayload(values: ListingFormOutput) {
  const isRent = values.listing_type === "rent";
  const monthly = values.price_monthly.trim();
  return {
    title: values.title,
    description: values.description,
    bedrooms: Number(values.bedrooms),
    bathrooms: Number(values.bathrooms),
    amenities: values.amenities,
    address_precise: values.address_precise,
    location: values.location,
    neighborhood: values.neighborhood,
    city: values.city,
    listing_type: values.listing_type,
    price_monthly: isRent ? monthly : monthly || null,
    price_one_time: isRent ? null : values.price_one_time,
    advance_rent_period: values.advance_rent_period || "none",
    virtual_tour_url: values.virtual_tour_url,
  };
}
