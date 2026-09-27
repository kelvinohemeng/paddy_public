"use client";

import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImagePlus, X } from "lucide-react";
import { useApiCreate, useApiOne, useApiUpdate } from "@/hooks/use-api";

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
import { loadGoogleMapsScript } from "@/lib/google-maps";
import { PlaceAutocompleteInput, type PlaceDetails } from "@/components/maps/place-autocomplete-input";
import { PhotoManager, type ManagedPhoto } from "./photo-manager";

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
// field, validation, and submit logic. It's shared between CREATE
// routes (@modal/(.)dashboard/[user]/listings/create docked panel +
// dashboard/[user]/listings/create/page.tsx full-page fallback) AND
// EDIT routes (@modal/(.)dashboard/[user]/listings/[id]/edit docked
// panel + dashboard/[user]/listings/[id]/edit/page.tsx full-page
// fallback), via the optional `listingId` prop — passing it switches
// action from "create" to "edit" and prefills every field from the
// existing record. All four wrap THIS component; this avoids writing
// the form's field/validation logic twice (or four times), which
// would risk versions silently drifting apart over time as the form
// grows.
//
// The landlord's own numeric id (the ":user" URL segment) is read here
// via useParams() rather than threaded down as a prop: every route that
// renders this component already sits under /dashboard/[user]/..., so
// the param is always present in the URL regardless of which of the
// four wrapper routes is active, and reading it locally means the
// wrapper components don't each need to re-extract and re-pass it.

// Ghana's rough center — used only as the map's initial view before
// any address has been picked. Landlords still need to explicitly
// place/confirm the pin; this is just where the map opens, not a
// default location value that could accidentally get submitted.
const GHANA_DEFAULT_CENTER = { lat: 7.9465, lng: -1.0232 };
const DEFAULT_MAP_ZOOM = 7;
const PICKED_MAP_ZOOM = 16;

type ListingCreateFormProps = {
  // When supplied, the form switches into edit mode: prefills from the
  // existing listing (plain GET + reset, see the hydrate effect)
  // instead of starting blank, and submits via update PUT rather than
  // create POST. Undefined/omitted = original create behavior.
  listingId?: string | number;
  // Called INSTEAD of the internal router navigation after a successful
  // save. Lets an inline (non-routed) edit toggle — e.g. the full-page
  // listing view at listings/[id]/page.tsx — flip straight back to view
  // mode without navigating, since the URL never changed in the first
  // place. Omitted = original router.push behavior, unchanged.
  onSuccess?: (listingId?: string | number) => void;
  // Called INSTEAD of router.back() when Cancel is clicked — the same
  // inline-toggle use case as onSuccess above.
  onCancel?: () => void;
};

export const ListingCreateForm = ({
  listingId,
  onSuccess,
  onCancel,
}: ListingCreateFormProps = {}) => {
  const router = useRouter();
  const params = useParams<{ user: string }>();
  const userId = params.user;
  const isEditMode = listingId !== undefined && listingId !== null;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  // Local state for the picked files — kept OUTSIDE react-hook-form's
  // own state on purpose. react-hook-form/zod validate FORM FIELD
  // values headed to POST /listings/; the photo upload is a
  // completely separate request to a different endpoint
  // (POST /listings/<id>/photos/) that only exists AFTER a listing is
  // created, so it never belongs in the same form's validated payload

  const [previews, setPreviews] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [mapsLoadError, setMapsLoadError] = useState<string | null>(null);
  const [locationPicked, setLocationPicked] = useState(false);
  const [coordsInput, setCoordsInput] = useState("");
  const [coordsError, setCoordsError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  // commitLocationRef lets the manual-paste handler (defined outside the
  // Maps-loading useEffect, so it works even before/without the script
  // ever loading) call the exact same commit path as autocomplete/map
  // click/drag — one function, three entry points, never disagreeing
  // on WKT format.
  const commitLocationRef = useRef<((lat: number, lng: number) => void) | null>(
    null,
  );

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

  // Plain react-hook-form (no resolver — parity with before; the
  // backend validates). Edit-mode prefill comes from recordData below,
  // applied once per listing by the hydrate effect.
  const form = useForm<Record<string, any>>();

  // Edit-mode record: plain GET /listings/<id>/. Replaces refine
  // useForm's action="edit" auto-apply (which also silently applied
  // values onto registered fields — the hydrate effect below is the
  // explicit equivalent).
  const { data: recordData } = useApiOne(
    "listings",
    isEditMode ? listingId : undefined,
  );

  // Apply the fetched record onto the form ONCE per listing. Guarded
  // by listingId (not by data identity) so a background refetch never
  // clobbers in-progress edits — after a successful save this
  // component navigates away (or the wrapper flips back to view mode)
  // anyway, so no re-hydration path is needed.
  const hydratedFor = useRef<string | number | null>(null);
  useEffect(() => {
    if (!isEditMode || !recordData || hydratedFor.current === listingId)
      return;
    hydratedFor.current = listingId ?? null;
    form.reset(recordData as Record<string, any>);
    // form.reset is stable (react-hook-form); recordData in deps so
    // the effect fires when the fetch lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode, listingId, recordData]);

  const createMutation = useApiCreate("listings");
  const updateMutation = useApiUpdate("listings");
  const formLoading = createMutation.isPending || updateMutation.isPending;

  // Shared post-save path for create AND update (replaces refine's
  // onMutationSuccess). Receives the saved listing DIRECTLY (no
  // {data} wrapper — apiPost/apiPut return the parsed body as-is),
  // INCLUDING its real database id, which the photo upload below
  // needs. In edit mode this is the SAME id as `listingId`, but
  // reading it from the response keeps this branch identical to the
  // create path.
  //
  // Navigation note: the old code needed redirect:false because
  // refine performed its OWN post-mutation navigation in addition to
  // this handler. Plain mutations navigate nowhere by themselves, so
  // the push below (or the wrapper's onSuccess) is now trivially the
  // ONLY navigation that happens — the race the old flag guarded
  // against cannot exist.
  async function handleSaveSuccess(saved: any) {
    // `saved` is the Listing object, INCLUDING its real database id —
    // the one thing needed before the photo upload request below can
    // even be built.
    const newListingId = saved?.id;

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
            // Same idle-expiry case as api-client's retry — one silent
            // refresh, then replay. If that fails too, move on: the
            // listing itself is already created, photos can be re-added
            // rather than blocking the whole success path.
            const fresh = await refreshAccessToken();
            if (fresh) photoRes = await uploadPhotos(fresh);
          }
          // Not using apiPost() here — this one-off multipart upload to
          // a custom @action endpoint doesn't fit the generic JSON
          // CRUD shape the api helpers assume. A direct fetch is the
          // right tool for this one genuinely special-shaped request.
        }

        if (onSuccess) {
          // Inline-toggle wrappers (see the onSuccess prop note) manage
          // their own "what happens now" — typically flipping back to
          // view mode. Nothing is navigated here; the wrapped page
          // decides, which keeps this shared form ignorant of chrome.
          onSuccess(newListingId);
          return;
        }

        router.push(
          isEditMode
            ? `/dashboard/${userId}/listings/${newListingId}`
            : `/dashboard/${userId}/listings`,
        );
        // Runs regardless of whether there were photos to upload — for
        // the panel case, this ALSO closes the panel, since it only
        // renders while the URL matches the intercepted route;
        // navigating away makes it disappear. Edit mode lands back on
        // the listing's preview rather than the bare list, since
        // that's the more useful place to confirm the update landed.
  }

  // --- Google Places Autocomplete + visual map picker on Location ---
  // Attaches Autocomplete directly to the real address_precise <Input>'s
  // underlying DOM node via ref, rather than rendering a separate
  // widget — keeps this additive to the existing form instead of
  // introducing a second "location" text input that could drift out
  // of sync with address_precise. The map below it gives a visual,
  // drag-to-adjust way to confirm/correct the exact pin — autocomplete
  // alone only resolves to Google's idea of the address, which isn't
  // always the actual building/gate (common for unpaved/unnamed roads
  // in parts of Accra/Kumasi).
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      setMapsLoadError(
        "Google Maps API key is not configured (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) — address autocomplete and the map are disabled, but you can still type the address manually.",
      );
      return;
    }

    let cancelled = false;

    // Shared by both the autocomplete callback and manual pin
    // drag/click — the ONE place that turns a lat/lng into the WKT
    // string the backend expects and pushes it into form state, so
    // the two input paths can never disagree about the format.
    function commitLocation(lat: number, lng: number) {
      // WKT format confirmed against the actual backend field
      // (django.contrib.gis PointField via GEOSGeometry): it
      // accepts "SRID=4326;POINT (lng lat)" — longitude BEFORE
      // latitude, matching GeoDjango's Point(x, y) convention
      // used elsewhere in this codebase (see listings/tests.py).
      const wkt = `SRID=4326;POINT (${lng} ${lat})`;
      form.setValue("location", wkt, { shouldDirty: true });
      setLocationPicked(true);
      setCoordsError(null);
      setCoordsInput(`${lat}, ${lng}`);
    }
    commitLocationRef.current = commitLocation;

    loadGoogleMapsScript(apiKey)
      .then(() => {
        if (cancelled) return;
        const google = (window as any).google;

        // --- Map + draggable marker ---
        if (mapDivRef.current && !mapRef.current) {
          const map = new google.maps.Map(mapDivRef.current, {
            center: GHANA_DEFAULT_CENTER,
            zoom: DEFAULT_MAP_ZOOM,
            streetViewControl: false,
            mapTypeControl: false,
            fullscreenControl: false,
            gestureHandling: "greedy",
            // "greedy" — scroll/drag/pinch interact with the map
            // immediately, no Ctrl+scroll or two-finger-gesture
            // requirement. Google's default ("cooperative") exists to
            // stop the map from hijacking page scroll on long pages,
            // but this map sits inside a small, deliberately-interacted
            // section of the form, so that tradeoff isn't worth the
            // extra friction here.
          });
          mapRef.current = map;

          const marker = new google.maps.Marker({
            map,
            position: GHANA_DEFAULT_CENTER,
            draggable: true,
            visible: true,
            // Visible and draggable from the start — a landlord can
            // drag this default pin into place even before/without
            // ever using autocomplete. Previously this stayed
            // invisible until a location existed, which meant "no pin
            // to drag" whenever autocomplete hadn't fired yet (e.g.
            // the API-key issues from earlier in this thread).
          });
          markerRef.current = marker;

          marker.addListener("dragend", () => {
            const pos = marker.getPosition();
            if (!pos) return;
            commitLocation(pos.lat(), pos.lng());
          });

          // Clicking anywhere on the map also drops/moves the pin —
          // faster than dragging from wherever it currently sits,
          // especially on the first pin placement.
          map.addListener("click", (e: any) => {
            const pos = e.latLng;
            if (!pos) return;
            marker.setPosition(pos);
            marker.setVisible(true);
            commitLocation(pos.lat(), pos.lng());
          });
        }

        setMapReady(true);
        // Signals the edit-mode prefill effect below that mapRef/markerRef
        // are now populated and safe to call — that effect depends on this
        // flag precisely because it can't otherwise tell "map creation
        // hasn't run yet" apart from "map creation failed silently."
      })
      .catch(() => {
        if (!cancelled) {
          setMapsLoadError(
            "Could not load Google Maps — address autocomplete and the map are unavailable, but you can still type the address manually.",
          );
        }
      });

    return () => {
      cancelled = true;
      if (markerRef.current && (window as any).google) {
        (window as any).google.maps.event.clearInstanceListeners(
          markerRef.current,
        );
      }
    };
    // form.setValue is stable across renders (react-hook-form), so this
    // effect intentionally runs once on mount, same lifecycle as the
    // original file-preview effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Edit-mode prefill: sync map pin + coords display from the
  // fetched record ---
  // The hydrate effect above applies the fetched record's values onto
  // every REGISTERED field (title, address_precise, city, etc.) — that
  // part needs no code here. But the map pin/marker and the
  // coordsInput text are local useState, not react-hook-form fields,
  // so they don't get that free ride; this effect is the one place
  // that reads the fetched `location` WKT and pushes it into the map +
  // coords display once both the record and the map are ready.
  useEffect(() => {
    if (!isEditMode) return;
    const wkt: string | undefined = (recordData as any)?.location;
    if (!wkt) return;

    // Parses the exact format commitLocation produces:
    // "SRID=4326;POINT (lng lat)" — same lng-before-lat order.
    const match = wkt.match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);
    if (!match) return;
    const lng = Number(match[1]);
    const lat = Number(match[2]);

    setLocationPicked(true);
    setCoordsInput(`${lat}, ${lng}`);

    if (mapRef.current && markerRef.current) {
      mapRef.current.setCenter({ lat, lng });
      mapRef.current.setZoom(PICKED_MAP_ZOOM);
      markerRef.current.setPosition({ lat, lng });
      markerRef.current.setVisible(true);
    }
    // Re-runs once the record data arrives AND again once the map
    // itself finishes loading (mapReady flips true after the Map +
    // Marker instances are created) — covers whichever of the two
    // loads second, since the pin can only actually be placed once
    // both the coordinates and the Google Map instance exist.
  }, [isEditMode, (recordData as any)?.location, mapReady]);

  // Manual "paste coordinates" fallback — accepts "lat, lng" (also lat/lng
  // separated by just whitespace, or a Google Maps-style "lat,lng" copy).
  // Feeds into the SAME commitLocation(...) used by autocomplete and the
  // map click/drag, via the ref, so the submitted WKT is built identically
  // no matter which of the three input methods a landlord actually used.
  function handleCoordsPaste(raw: string) {
    setCoordsInput(raw);
    const match = raw.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (!match) {
      setCoordsError(
        raw.trim() ? "Enter as \"latitude, longitude\", e.g. 5.6037, -0.1870" : null,
      );
      return;
    }
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setCoordsError("Latitude must be -90..90 and longitude -180..180.");
      return;
    }
    setCoordsError(null);
    commitLocationRef.current?.(lat, lng);
    if (mapRef.current && markerRef.current) {
      mapRef.current.setCenter({ lat, lng });
      mapRef.current.setZoom(PICKED_MAP_ZOOM);
      markerRef.current.setPosition({ lat, lng });
      markerRef.current.setVisible(true);
    }
  }

  // Handles a place picked from the new PlaceAutocompleteInput wrapper
  // — replaces the old inline place_changed listener that used to
  // live inside the map-loading effect above (the OLD Autocomplete
  // class had to be constructed inside that same effect since it
  // attached to a DOM node from a ref; PlaceAutocompleteInput owns its
  // own script-loading lifecycle independently, so this callback can
  // live as a plain function instead).
  function handlePlaceSelect(place: PlaceDetails) {
    if (place.location) {
      commitLocationRef.current?.(place.location.lat, place.location.lng);

      // Move the map + marker to match, and zoom in so the landlord
      // can immediately see/adjust the exact pin rather than
      // confirming blind.
      if (mapRef.current && markerRef.current) {
        mapRef.current.setCenter(place.location);
        mapRef.current.setZoom(PICKED_MAP_ZOOM);
        markerRef.current.setPosition(place.location);
        markerRef.current.setVisible(true);
      }
    }
    // No location at all — user picked a prediction Places couldn't
    // geocode further, or something went wrong fetching fields. Same
    // "leave existing location alone" behavior as the old handler.

    // Best-effort autofill for neighborhood/city from Places'
    // address_components — still editable afterward, this just saves
    // re-typing what Places already knows.
    const components = place.addressComponents ?? [];
    const findComponent = (type: string) =>
      components.find((c) => c.types.includes(type))?.longText;

    const neighborhood =
      findComponent("neighborhood") || findComponent("sublocality");
    const city =
      findComponent("locality") || findComponent("administrative_area_level_2");

    if (neighborhood) {
      form.setValue("neighborhood", neighborhood, { shouldDirty: true });
    }
    if (city) {
      form.setValue("city", city, { shouldDirty: true });
    }
  }

  function onSubmit(values: Record<string, any>) {
    // Listing.clean() keeps exactly ONE price field meaningful per
    // type (rent -> price_monthly + advance_rent_period, buy ->
    // price_one_time), but the DRF serializer accepts whatever the
    // client sends — full_clean() isn't run by ModelViewSet. So the
    // form normalizes BEFORE submit: the field that doesn't apply is
    // nulled-out here rather than trusting the disabled section alone
    // (the hidden field would otherwise still ride along in values).
    const payload: Record<string, any> = { ...values };
    const listingType = payload.listing_type || "rent";
    if (listingType === "buy") {
      payload.price_monthly = null;
      payload.advance_rent_period = "none";
    } else {
      payload.price_one_time = null;
    }

    // NOTE: selectedFiles is NOT part of `values` — it's handled
    // entirely separately in handleSaveSuccess above, once we have a
    // real listing id to attach photos to.
    //
    // `location` rides along inside `values` the same way as any other
    // registered field — set via form.setValue above from the Places
    // autocomplete callback, or left undefined if the landlord never
    // picked a suggestion (matches the model's location field being
    // null=True/blank=True — genuinely optional).
    const saveOptions = {
      onSuccess: handleSaveSuccess,
      // Refine used to toast mutation errors automatically via its
      // notification provider — explicit here instead.
      onError: (err: Error) => toast.error(err.message),
    };
    if (isEditMode) {
      updateMutation.mutate({ id: listingId!, ...payload }, saveOptions);
    } else {
      createMutation.mutate(payload, saveOptions);
    }
  }

  const existingPhotoCount = isEditMode
    ? (((recordData as any)?.photos as ManagedPhoto[] | undefined)?.length ?? 0)
    : 0;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-7">
        {/* Photos first: they're what sells a listing, and uploading
            them is the step landlords most often forget. Same section
            styling as the rest of the form. */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold tracking-tight">Photos</h3>
            <span className="text-muted-foreground text-xs">
              {photoCountLabel(existingPhotoCount, selectedFiles.length)}
            </span>
          </div>

          {/* Gallery management for ALREADY-UPLOADED photos — only
              meaningful in edit mode (create mode has no listing id yet,
              so no photos can exist). Reads the photos nested on this
              form's own record query; cover/reorder/delete requests go
              through photo-manager.tsx's PATCH/DELETE contract
              (backend PR #16). Freshly-picked-but-unuploaded files are
              NOT here — they remain in the picker grid below until the
              next save uploads them. */}
          {isEditMode &&
            (recordData as any)?.photos &&
            ((recordData as any).photos as ManagedPhoto[]).length > 0 && (
              <PhotoManager
                listingId={listingId!}
                photos={(recordData as any).photos as ManagedPhoto[]}
              />
            )}

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

          {uploadError && <p className="text-destructive text-sm">{uploadError}</p>}
        </section>

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
          <FormItem>
            <FormLabel>Address</FormLabel>
            <FormControl>
              <Controller
                control={form.control}
                name="address_precise"
                rules={{ required: "Address is required" }}
                render={({ field }) => (
                  <PlaceAutocompleteInput
                    value={field.value || ""}
                    onChange={field.onChange}
                    onPlaceSelect={(place) => {
                      field.onChange(place.formattedAddress ?? field.value ?? "");
                      handlePlaceSelect(place);
                    }}
                    placeholder="Start typing an address…"
                    // Worldwide — no region restriction, anyone from
                    // anywhere can list.
                  />
                )}
              />
            </FormControl>
            {mapsLoadError ? (
              <p className="text-muted-foreground text-xs">{mapsLoadError}</p>
            ) : (
              <p className="text-muted-foreground text-xs">
                {locationPicked
                  ? "Coordinates captured from your selection."
                  : "Pick a suggestion from the dropdown to capture exact coordinates."}
              </p>
            )}
            {form.formState.errors.address_precise && (
              <p className="text-destructive text-sm font-medium">
                {String(form.formState.errors.address_precise.message)}
              </p>
            )}
          </FormItem>

          {/* Hidden field: holds the WKT location string set by either
              the Places autocomplete callback or the map's marker
              drag/click handler above. Registered with react-hook-form
              via Controller (not a visible <Input>) so it rides along
              in the submitted `values` the same way every other field
              does, without a landlord ever seeing or editing raw WKT
              text directly. */}
          <Controller
            control={form.control}
            name="location"
            render={() => <></>}
          />

          {/* Visual map + draggable pin — confirms/corrects whatever
              coordinates autocomplete resolved to, or lets a landlord
              place a pin manually when the address doesn't resolve
              cleanly (unpaved/unnamed roads are common enough here
              that autocomplete alone isn't sufficient). Click the map
              or drag the pin once it appears; either one calls the
              same commitLocation(...) path as autocomplete, so the
              submitted WKT is always built the same way regardless of
              which input method was actually used. */}
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Or paste coordinates</p>
            <Input
              value={coordsInput}
              onChange={(e) => handleCoordsPaste(e.target.value)}
              placeholder="e.g. 5.6037, -0.1870"
              autoComplete="off"
            />
            {coordsError ? (
              <p className="text-destructive text-xs">{coordsError}</p>
            ) : (
              <p className="text-muted-foreground text-xs">
                Paste &ldquo;latitude, longitude&rdquo; (e.g. from Google
                Maps&rsquo; share link) to drop the pin exactly — handy when
                the address doesn&rsquo;t resolve cleanly via autocomplete.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">Pin on map (optional refinement)</p>
            <div
              ref={mapDivRef}
              className="h-64 w-full rounded-md border"
              // A bare, ref-only div — Google Maps renders directly
              // into this DOM node imperatively (see the useEffect
              // above), it isn't React-controlled content
            />
            <p className="text-muted-foreground text-xs">
              {mapsLoadError
                ? "Map unavailable — you can still save the listing without exact coordinates."
                : "Click the map or drag the pin to fine-tune the exact location."}
            </p>
          </div>

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
                <Select
                  value={field.value || "rent"}
                  onValueChange={(value) => {
                    field.onChange(value);
                    // Swap which price section shows, and clear the field
                    // that no longer applies (matches Listing.clean()'s
                    // rent/buy split) so a stale value can't ride along in
                    // the submitted payload. onSubmit below re-normalizes
                    // as a final safety net regardless.
                    if (value === "buy") {
                      form.setValue("price_monthly", null);
                      form.setValue("advance_rent_period", "none");
                    } else {
                      form.setValue("price_one_time", null);
                    }
                  }}
                >
                  {/* Matches Listing.ListingType choices exactly (rent/buy)
                      — the VALUE sent must match the backend's stored
                      choice string, not the human label. Controlled via
                      `value` (not defaultValue) so the edit-mode prefill
                      actually surfaces the record's real type. */}
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

          {(form.watch("listing_type") || "rent") === "rent" ? (
            <>
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

              <FormField
                control={form.control}
                name="advance_rent_period"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Advance Rent Period</FormLabel>
                    <Select
                      value={field.value || "none"}
                      onValueChange={field.onChange}
                    >
                      {/* Matches Listing.AdvanceRentPeriod choices exactly —
                          a rent listing commonly demands 6 or 12 months paid
                          upfront in this market, which is one of paddy's core
                          filters ("6 months vs 1 year"). */}
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select advance period" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None / no advance</SelectItem>
                        <SelectItem value="6_months">6 Months</SelectItem>
                        <SelectItem value="1_year">1 Year</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          ) : (
            <FormField
              control={form.control}
              name="price_one_time"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>One-Time Price (GHS)</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      min={0}
                      value={field.value || ""}
                      onChange={(e) => field.onChange(e.target.value)}
                      // Same string-not-float reasoning as price_monthly —
                      // DRF's DecimalField accepts the string directly.
                      placeholder="e.g. 450000"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="virtual_tour_url"
            render={({ field }) => (
              <FormItem>
                <FormLabel>360° Tour URL (optional)</FormLabel>
                <FormControl>
                  {/* URLField on the backend — optional, the photosphere
                      may not be ready when a listing is first created. */}
                  <Input
                    {...field}
                    value={field.value || ""}
                    type="url"
                    placeholder="https://…"
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

        <div className="flex gap-2 border-t pt-5">
          <Button type="submit" disabled={formLoading} className="flex-1">
            {formLoading
              ? isEditMode
                ? "Saving..."
                : "Creating..."
              : isEditMode
                ? "Save Changes"
                : "Create Listing"}
          </Button>
          <Button type="button" variant="outline" onClick={() => (onCancel ? onCancel() : router.back())}>
            {/* onCancel — used by inline-toggle wrappers (the full-page
                listing view) to flip back to view mode without a
                navigation. Otherwise router.back(): for the panel case,
                this closes the panel by returning to whatever URL was
                active before navigating to .../listings/create (Next.js's
                intercepting-route pattern relies on this: the panel only
                exists because the URL changed via client-side navigation,
                so navigating back un-renders it). For the full-page
                fallback case, this just acts like a normal browser back
                button. */}
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  );
};

// "3 uploaded · 2 to upload" — counts photos already on the listing
// (edit mode) as well as freshly picked ones, so an edit form with a
// full gallery no longer says "No photos yet".
function photoCountLabel(uploaded: number, picked: number): string {
  if (uploaded === 0 && picked === 0) return "No photos yet";
  const parts = [];
  if (uploaded > 0) parts.push(`${uploaded} uploaded`);
  if (picked > 0) parts.push(`${picked} to upload`);
  return parts.join(" · ");
}
