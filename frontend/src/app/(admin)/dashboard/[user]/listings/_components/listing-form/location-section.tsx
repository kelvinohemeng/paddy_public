"use client";

import { useEffect, useRef, useState } from "react";
import { Controller, useFormContext, useFormState } from "react-hook-form";
import { Search } from "lucide-react";

import {
  PlaceAutocompleteInput,
  type PlaceDetails,
} from "@/components/maps/place-autocomplete-input";
import { loadGoogleMapsScript } from "@/lib/google-maps";
import { cn } from "@/lib/utils";
import { FormRow, INPUT_CLASS } from "./form-parts";
import {
  parseWktPoint,
  toWktPoint,
  type ListingFieldName,
  type ListingFormValues,
} from "./schema";

// Step 2 (Location). Figma 288:8254: Address (a search field) beside
// "Or paste coordinates (Optional)", then the map (radius 20, 1px #d9d9d9
// hairline). Figma labels the map "Or Paste Coordinates" too — a copy
// slip; it's "Pin on map" here. Neighbourhood and City aren't in the
// frame but the backend requires both, so they close the step.
//
// Three ways to set the point, ONE commit path (commitLocation), so the
// WKT sent to the backend is always built the same way:
//   1. pick an address suggestion (Google Places) — also fills in the
//      neighbourhood and city when Places knows them;
//   2. click the map or drag the pin — for unpaved or unnamed roads,
//      where Places' idea of the address isn't the actual gate;
//   3. paste "lat, lng" — works even if Google Maps never loads.
//
// The pin is REQUIRED (Kelvin, 2026-09-28): the Discovery Hub is map-
// driven, so a listing without coordinates would never be found there.
//
// The stepper keeps every step mounted (hidden when not current), so the
// map is created once and survives Back/Next. It's created the first time
// this step is shown (`active`), not on mount — a Google Map built inside
// a hidden (display:none) element renders as a blank grey box.

// Ghana's rough centre — only where the map OPENS before a point exists.
// Never submitted: the landlord still has to place the pin.
const GHANA_DEFAULT_CENTER = { lat: 7.9465, lng: -1.0232 };
const DEFAULT_MAP_ZOOM = 7;
const PICKED_MAP_ZOOM = 16;

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

export const LOCATION_FIELDS = [
  "address_precise",
  "location",
  "neighborhood",
  "city",
] as const satisfies readonly ListingFieldName[];

export function LocationSection({ active }: { active: boolean }) {
  const { control, register, setValue, getValues } =
    useFormContext<ListingFormValues>();
  const { errors } = useFormState({ control, name: "location" });

  const mapDivRef = useRef<HTMLDivElement>(null);
  // The Maps JS objects are untyped here, same as the rest of the app's
  // Google Maps code (loaded at runtime, not bundled).
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [coordsInput, setCoordsInput] = useState(() => {
    const point = parseWktPoint(getValues("location"));
    return point ? `${point.lat}, ${point.lng}` : "";
  });
  const [coordsError, setCoordsError] = useState<string | null>(null);

  const mapsError = !API_KEY
    ? "Google Maps isn't configured, so the map and address suggestions are off. Paste coordinates instead."
    : loadFailed
      ? "Google Maps didn't load, so the map and address suggestions are off. Paste coordinates instead."
      : null;

  // Moves the visible map + pin; no form change. Safe to call before the
  // map exists (it just does nothing yet).
  function showOnMap(lat: number, lng: number) {
    if (!mapRef.current || !markerRef.current) return;
    mapRef.current.setCenter({ lat, lng });
    mapRef.current.setZoom(PICKED_MAP_ZOOM);
    markerRef.current.setPosition({ lat, lng });
    markerRef.current.setVisible(true);
  }

  // THE one place a lat/lng becomes the form's `location` value.
  // WKT "SRID=4326;POINT (lng lat)" — longitude first, GeoDjango's
  // Point(x, y) order (see listings/tests.py). shouldValidate clears a
  // "set the exact spot" error the moment a point exists.
  function commitLocation(lat: number, lng: number) {
    setValue("location", toWktPoint(lat, lng), {
      shouldDirty: true,
      shouldValidate: true,
    });
    setCoordsInput(`${lat}, ${lng}`);
    setCoordsError(null);
  }
  // The map's click/drag listeners are attached once, when the map is
  // built; a ref lets them always call the latest commitLocation.
  const commitRef = useRef(commitLocation);
  useEffect(() => {
    commitRef.current = commitLocation;
  });

  useEffect(() => {
    if (!active || !API_KEY || mapRef.current) return;
    let cancelled = false;

    loadGoogleMapsScript(API_KEY)
      .then(() => {
        if (cancelled || !mapDivRef.current || mapRef.current) return;
        const google = (window as any).google;
        const start = parseWktPoint(getValues("location"));

        const map = new google.maps.Map(mapDivRef.current, {
          center: start ?? GHANA_DEFAULT_CENTER,
          zoom: start ? PICKED_MAP_ZOOM : DEFAULT_MAP_ZOOM,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          // "greedy": drag/scroll/pinch move the map straight away. The
          // default ("cooperative") protects page scrolling on long
          // pages, but this map is a small, deliberately-used control.
          gestureHandling: "greedy",
        });
        mapRef.current = map;

        // Hidden until a point exists: a pin sitting at the default
        // centre would look like a location had been chosen.
        const marker = new google.maps.Marker({
          map,
          position: start ?? GHANA_DEFAULT_CENTER,
          draggable: true,
          visible: Boolean(start),
        });
        markerRef.current = marker;

        marker.addListener("dragend", () => {
          const pos = marker.getPosition();
          if (pos) commitRef.current(pos.lat(), pos.lng());
        });
        // Clicking anywhere drops (or moves) the pin — quicker than
        // dragging it from wherever it sits, especially the first time.
        map.addListener("click", (e: any) => {
          const pos = e.latLng;
          if (!pos) return;
          marker.setPosition(pos);
          marker.setVisible(true);
          commitRef.current(pos.lat(), pos.lng());
        });
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });

    return () => {
      cancelled = true;
    };
    // getValues is stable (react-hook-form). Runs when the step is first
    // shown; the mapRef guard makes later runs no-ops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Drop the map's listeners when the form goes away for good.
  useEffect(
    () => () => {
      const google = (window as any).google;
      if (!google?.maps) return;
      if (markerRef.current) google.maps.event.clearInstanceListeners(markerRef.current);
      if (mapRef.current) google.maps.event.clearInstanceListeners(mapRef.current);
    },
    [],
  );

  // "Paste coordinates": accepts "lat, lng", "lat lng", or Google Maps'
  // "lat,lng" copy. Commits through the same path as the map.
  function handleCoordsInput(raw: string) {
    setCoordsInput(raw);
    const match = raw
      .trim()
      .match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (!match) {
      setCoordsError(
        raw.trim() ? 'Enter "latitude, longitude", e.g. 5.6037, -0.1870' : null,
      );
      return;
    }
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setCoordsError("Latitude must be -90 to 90 and longitude -180 to 180.");
      return;
    }
    commitLocation(lat, lng);
    showOnMap(lat, lng);
  }

  function handlePlaceSelect(place: PlaceDetails) {
    // No point at all = Places couldn't geocode this pick; leave any
    // existing pin alone (the landlord can still place it by hand).
    if (place.location) {
      commitLocation(place.location.lat, place.location.lng);
      showOnMap(place.location.lat, place.location.lng);
    }

    // Best-effort neighbourhood / city from Places' address components —
    // still editable, this just saves retyping what Places knows.
    const components = place.addressComponents ?? [];
    const find = (type: string) =>
      components.find((c) => c.types.includes(type))?.longText;
    const neighborhood = find("neighborhood") || find("sublocality");
    const city = find("locality") || find("administrative_area_level_2");
    if (neighborhood) {
      setValue("neighborhood", neighborhood, { shouldDirty: true, shouldValidate: true });
    }
    if (city) {
      setValue("city", city, { shouldDirty: true, shouldValidate: true });
    }
  }

  const locationError = errors.location;

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-8 md:grid-cols-2">
        <FormRow name="address_precise" label="Address">
          {({ id, invalid, describedBy }) => (
            <Controller
              control={control}
              name="address_precise"
              render={({ field }) => (
                <div className="relative">
                  <Search
                    aria-hidden
                    className="text-field-placeholder pointer-events-none absolute top-4 left-4 z-10 size-6"
                    strokeWidth={2}
                  />
                  <PlaceAutocompleteInput
                    id={id}
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    onPlaceSelect={handlePlaceSelect}
                    invalid={invalid}
                    describedBy={describedBy}
                    placeholder="Start typing an address"
                    inputClassName={cn(INPUT_CLASS, "h-14 pl-12 shadow-none md:text-base")}
                  />
                </div>
              )}
            />
          )}
        </FormRow>

        <FormRow label="Or paste coordinates" optional>
          {({ id }) => (
            <div className="flex flex-col gap-1.5">
              <input
                id={id}
                value={coordsInput}
                onChange={(e) => handleCoordsInput(e.target.value)}
                placeholder="e.g. 5.6037, -0.1870"
                autoComplete="off"
                inputMode="decimal"
                aria-invalid={coordsError ? true : undefined}
                className={INPUT_CLASS}
              />
              <p
                className={cn(
                  "text-[13px] leading-5",
                  coordsError ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {coordsError ??
                  "From a Google Maps share link — handy when the address doesn't come up."}
              </p>
            </div>
          )}
        </FormRow>
      </div>

      <FormRow name="location" label="Pin on map" labelType="plus">
        {({ describedBy }) => (
          <div className="flex flex-col gap-1.5">
            <div
              ref={mapDivRef}
              // A bare, ref-only div: Google Maps draws into it directly.
              aria-describedby={describedBy}
              className={cn(
                "bg-surface h-72 w-full overflow-hidden rounded-[20px] border md:h-[360px]",
                locationError ? "border-destructive" : "border-hairline",
              )}
            />
            <p className="text-muted-foreground text-[13px] leading-5">
              {mapsError ??
                "Click the map to drop the pin, then drag it onto the exact gate or door."}
            </p>
          </div>
        )}
      </FormRow>

      <div className="grid grid-cols-2 gap-4 md:gap-8">
        <FormRow name="neighborhood" label="Neighbourhood">
          {({ id, invalid, describedBy }) => (
            <input
              id={id}
              {...register("neighborhood")}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              placeholder="East Legon"
              maxLength={100}
              className={INPUT_CLASS}
            />
          )}
        </FormRow>
        <FormRow name="city" label="City">
          {({ id, invalid, describedBy }) => (
            <input
              id={id}
              {...register("city")}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              placeholder="Accra"
              maxLength={100}
              className={INPUT_CLASS}
            />
          )}
        </FormRow>
      </div>
    </div>
  );
}
