"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "@refinedev/react-hook-form";
import { Controller } from "react-hook-form";
import { useRouter } from "next/navigation";
import { ImagePlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AmenityPicker } from "./amenity-picker";
import { refreshAccessToken } from "@/lib/auth-refresh";

// Backend's ListingPhoto.image field only accepts these extensions
// (FileExtensionValidator in listings/models.py) — matching the
// exact same list here means a user gets rejected at PICK time, not
// after already waiting on a failed upload
const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];

// This component holds the ENTIRE actual form — every real Listing
// field, validation, and submit logic. It's shared between:
//   1. @modal/(.)create/page.tsx  — the docked right-side panel version
//   2. create/page.tsx            — the full-page fallback version
// Both just wrap THIS component in different chrome. This avoids
// writing the form's actual logic twice, which would risk the two
// versions silently drifting apart over time as the form grows.

export const ListingCreateForm = () => {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  // Local state for the picked files — kept OUTSIDE react-hook-form's
  // own state on purpose. react-hook-form/zod validate FORM FIELD
  // values headed to POST /listings/; the photo upload is a
  // completely separate request to a different endpoint
  // (POST /listings/<id>/photos/) that only exists AFTER a listing is
  // created, so it never belongs in the same form's validated payload

  const [previews, setPreviews] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Object-URL thumbnails for the picked files. Created when the
  // selection changes, revoked on cleanup so we never leak blob URLs.
  useEffect(() => {
    if (selectedFiles.length === 0) {
      setPreviews([]);
      return;
    }
    const urls = selectedFiles.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [selectedFiles]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // FileList (what e.target.files actually is) isn't a real array —
    // it has a .length and index access but none of Array's methods
    // (.filter, .map, etc.). Array.from(...) converts it into a real
    // array so the rest of this function can use normal array methods.
    if (files.length === 0) return;

    const invalid = files.filter((f) => !ACCEPTED_IMAGE_TYPES.includes(f.type));

    if (invalid.length > 0) {
      setUploadError(
        `${invalid
          .map((f) => f.name)
          .join(", ")} — only JPG, PNG, and WEBP images are allowed.`,
      );
      // Reject just this batch, keep whatever was already picked —
      // friendlier than wiping the whole selection over one bad file.
      e.target.value = "";
      return;
    }

    setUploadError(null);
    setSelectedFiles((prev) => {
      // De-dupe against what's already picked (same name + size +
      // lastModified = almost certainly the same file re-picked), so
      // repeat selections don't stack duplicates in the grid.
      const incoming = files.filter(
        (f) =>
          !prev.some(
            (p) =>
              p.name === f.name &&
              p.size === f.size &&
              p.lastModified === f.lastModified,
          ),
      );
      return [...prev, ...incoming];
    });
    // Reset the input so picking the SAME file again still fires
    // onChange (browsers won't re-fire for an unchanged value).
    e.target.value = "";
  }

  function removeFile(index: number) {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setUploadError(null);
  }

  const {
    refineCore: { onFinish, formLoading },
    ...form
  } = useForm({
    refineCoreProps: {
      resource: "listings",
      action: "create",
      // Explicit here (unlike blog-posts/create, which inferred the
      // resource from its URL) — because this component gets rendered
      // from TWO different routes (the panel's intercepted path and
      // the real /listings/create path), so relying on "infer from
      // current URL" would be fragile; being explicit means this
      // component behaves identically no matter which route rendered it
      onMutationSuccess: async (data) => {
        // onMutationSuccess receives the actual server response from
        // creating the listing — data.data is the new Listing object,
        // INCLUDING its real database id, which is the one thing we
        // need before the photo upload request can even be built
        const newListingId = data?.data?.id;

        if (newListingId && selectedFiles.length > 0) {
          const formData = new FormData();
          // FormData, not JSON — this is what actually lets fetch()
          // send real binary file data as multipart/form-data, the
          // format request.FILES on the Django side expects. You
          // cannot send files as JSON.stringify(...) at all.

          selectedFiles.forEach((file) => {
            formData.append("images", file);
            // Appending multiple files under the SAME key ("images")
            // is exactly what request.FILES.getlist('images') on the
            // backend expects — one key, many values, not
            // "images[0]", "images[1]", etc.
          });

          const token = localStorage.getItem("access_token");

          const uploadPhotos = (accessToken: string | null) =>
            fetch(
              `${process.env.NEXT_PUBLIC_API_URL}/listings/${newListingId}/photos/`,
              {
                method: "POST",
                headers: { Authorization: `Bearer ${accessToken}` },
                // Deliberately NO "Content-Type" header here — the browser
                // sets multipart/form-data WITH the correct boundary
                // string itself when the body is a FormData object.
                // Setting Content-Type manually would actually BREAK
                // this, since you'd be guessing the boundary wrong.
                body: formData,
              },
            );

          let photoRes = await uploadPhotos(token);
          if (photoRes.status === 401) {
            // Same idle-expiry case as dataProvider's retry above — one
            // silent refresh, then replay. If that fails too, move on:
            // the listing itself is already created, photos can be
            // re-added rather than blocking the whole success path.
            const fresh = await refreshAccessToken();
            if (fresh) photoRes = await uploadPhotos(fresh);
          }
          // Not using dataProvider.create() here — this one-off
          // multipart upload to a custom @action endpoint doesn't fit
          // the generic resource CRUD shape dataProvider methods
          // assume (create/getList/etc. all assume JSON bodies against
          // standard REST paths). A direct fetch is the right tool for
          // this one genuinely special-shaped request.
        }

        router.push("/listings");
        // Runs regardless of whether there were photos to upload —
        // for the panel case, this ALSO closes the panel, since it
        // only renders while the URL matches the intercepted
        // /listings/create path; navigating away makes it disappear
      },
    },
  });

  function onSubmit(values: Record<string, any>) {
    onFinish(values);
    // onFinish is Refine's own function — internally calls
    // dataProvider.create({ resource: "listings", variables: values }),
    // which is the generic create() function you already wrote in
    // data-provider/index.ts. Nothing listing-specific lives in that
    // file; this call site is where "these values belong to a listing"
    // actually gets decided. Note selectedFiles is NOT part of
    // `values` — it's handled entirely separately in onMutationSuccess
    // above, once we have a real listing id to attach photos to.
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-7">
        <section className="space-y-4">
          <h3 className="text-sm font-semibold tracking-tight">Basics</h3>
          <FormField
            control={form.control}
            name="title"
            rules={{ required: "Title is required" }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Title</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value || ""}
                    placeholder="e.g. Cozy 2-Bedroom in East Legon"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="description"
            rules={{ required: "Description is required" }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    value={field.value || ""}
                    rows={4}
                    placeholder="Light, ventilation, water, power backup, access…"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="bedrooms"
              rules={{ required: "Bedrooms is required" }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bedrooms</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      min={0}
                      value={field.value || ""}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                      // DRF's PositiveIntegerField expects a real number,
                      // not a string — plain HTML inputs always hand back
                      // strings via e.target.value, so this explicitly
                      // converts before it ever reaches onFinish/the
                      // dataProvider, rather than relying on the backend
                      // to coerce it (it might, but don't rely on it)
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="bathrooms"
              rules={{ required: "Bathrooms is required" }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bathrooms</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      min={0}
                      value={field.value || ""}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-sm font-semibold tracking-tight">Location</h3>
          <FormField
            control={form.control}
            name="address_precise"
            rules={{ required: "Address is required" }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Address</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value || ""}
                    placeholder="House number, street"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="neighborhood"
              rules={{ required: "Neighborhood is required" }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Neighborhood</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value || ""}
                      placeholder="East Legon"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="city"
              rules={{ required: "City is required" }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>City</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value || ""}
                      placeholder="Accra"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-sm font-semibold tracking-tight">
            Pricing &amp; type
          </h3>
          <FormField
            control={form.control}
            name="listing_type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Listing Type</FormLabel>
                <Select onValueChange={field.onChange} defaultValue="rent">
                  {/* Matches Listing.ListingType choices exactly (rent/buy)
                      — the VALUE sent must match the backend's stored
                      choice string, not the human label */}
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="rent">Rent</SelectItem>
                    <SelectItem value="buy">Buy</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="price_monthly"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Monthly Price (GHS)</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="number"
                    min={0}
                    value={field.value || ""}
                    onChange={(e) => field.onChange(e.target.value)}
                    // Left as a string here deliberately — Listing.price_monthly
                    // is a DecimalField on the backend, and DRF's
                    // DecimalField happily accepts a numeric string like
                    // "2500.00" without needing JS-side float conversion,
                    // which risks floating-point rounding on money values
                    placeholder="e.g. 2500"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        <section className="space-y-4">
          <h3 className="text-sm font-semibold tracking-tight">Amenities</h3>
          <Controller
            control={form.control}
            name="amenities"
            render={({ field }) => (
              <AmenityPicker
                value={field.value ?? []}
                onChange={field.onChange}
              />
            )}
            // Same Controller pattern used for the role picker in
            // sign-up-form.tsx — AmenityPicker is a custom component
            // with its own value/onChange shape (an array of ids), not
            // a native input, so it can't be spread via {...field}
            // the way a plain <Input> can. Controller is
            // react-hook-form's purpose-built bridge for exactly this.
            //
            // "amenities" here matches ListingSerializer's real field
            // name exactly (confirmed earlier via direct introspection:
            // amenities, required=False) — it expects a list of
            // Amenity ids, which is precisely what field.value holds.
          />
        </section>

        <section className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium leading-none">Photos</p>
            <span className="text-muted-foreground text-xs">
              {selectedFiles.length === 0
                ? "No photos yet"
                : `${selectedFiles.length} selected`}
            </span>
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="hover:bg-muted/50 flex w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed px-4 py-7 text-center transition"
          >
            <ImagePlus className="text-muted-foreground size-6" />
            <span className="text-sm font-medium">
              Click to select photos
            </span>
            <span className="text-muted-foreground text-xs">
              JPG, PNG or WEBP — pick once or add more in batches
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            // The "accept" attribute is a UI HINT ONLY — it filters
            // what the OS file picker shows/allows by default, but a
            // user can often still bypass it (e.g. "All Files" in the
            // picker dialog). It is NOT real validation, which is why
            // handleFileChange above re-checks every file's actual
            // .type regardless of what this attribute suggests.
            onChange={handleFileChange}
            className="hidden"
          />

          {previews.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {previews.map((src, i) => (
                <div
                  key={`${selectedFiles[i]?.name}-${i}`}
                  className="bg-muted group relative aspect-square overflow-hidden rounded-md border"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={selectedFiles[i]?.name ?? `Photo ${i + 1}`}
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    aria-label={`Remove ${selectedFiles[i]?.name ?? "photo"}`}
                    className="absolute right-1.5 top-1.5 rounded-full bg-black/70 p-1 text-white transition hover:bg-black focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                  <p className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-1 text-[11px] text-white">
                    {selectedFiles[i]?.name}
                  </p>
                </div>
              ))}
            </div>
          )}

          {uploadError && <p className="text-sm text-red-500">{uploadError}</p>}
        </section>

        <div className="flex gap-2 border-t pt-5">
          <Button type="submit" disabled={formLoading} className="flex-1">
            {formLoading ? "Creating..." : "Create Listing"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            {/* router.back() — for the panel case, this closes the panel
                by returning to whatever URL was active before navigating
                to /listings/create (Next.js's intercepting-route pattern
                relies on this: the panel only exists because the URL
                changed via client-side navigation, so navigating back
                un-renders it). For the full-page fallback case, this
                just acts like a normal browser back button. */}
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  );
};
