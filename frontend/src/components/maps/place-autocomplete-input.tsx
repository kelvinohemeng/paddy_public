"use client";

import { useEffect, useRef } from "react";
import { loadGoogleMapsScript } from "@/lib/google-maps";

// Wraps google.maps.places.PlaceAutocompleteElement — the class Google
// now recommends over the deprecated google.maps.places.Autocomplete
// (Autocomplete stopped being available to new customers as of March
// 1, 2025; still works for existing projects but only receives major-
// regression fixes, not real bug fixes — see
// https://developers.google.com/maps/documentation/javascript/places-migration-overview).
//
// This is a REAL architectural difference, not just a renamed class:
// the old Autocomplete attached itself to an EXISTING <input> element
// (new Autocomplete(inputRef.current, {...})). PlaceAutocompleteElement
// is its own custom element (<gmp-place-autocomplete>) that creates
// and owns its OWN internal input — it can't be attached to one of
// react-hook-form's registered <Input>s the way the old class could.
// This component is the bridge: it mounts the custom element
// imperatively into a container div, and surfaces its value/selection
// back out through plain value/onChange props, so callers can still
// wire it into react-hook-form via Controller exactly like any other
// controlled field.
//
// Styling: PlaceAutocompleteElement renders inside a CLOSED shadow
// root by default, which blocks normal CSS selectors from reaching
// its internal input at all. Google documents a specific, small set
// of properties that ARE supported as direct overrides from outside
// the shadow boundary (background-color, border, border-radius,
// color, font*, line-height) — this component sets exactly those,
// applied as inline styles on the host element, rather than attempting
// any shadow-DOM-forcing hacks (monkey-patching Element.prototype.
// attachShadow, as some blog workarounds do) to reach further in.

export type PlaceDetails = {
  formattedAddress: string | null;
  location: { lat: number; lng: number } | null;
  addressComponents: Array<{ longText: string; shortText: string; types: string[] }> | null;
};

type PlaceAutocompleteInputProps = {
  value: string;
  onChange: (value: string) => void;
  onPlaceSelect?: (place: PlaceDetails) => void;
  placeholder?: string;
  className?: string;
  // Google's NEW restriction properties — the old Autocomplete's
  // `componentRestrictions: { country }` / `types: [...]` are replaced
  // by `includedRegionCodes` (ISO country codes) and
  // `includedPrimaryTypes` (Places API (New) type strings, e.g.
  // "locality" for cities, vs. the legacy "(cities)" magic string).
  includedRegionCodes?: string[];
  includedPrimaryTypes?: string[];
};

export function PlaceAutocompleteInput({
  value,
  onChange,
  onPlaceSelect,
  placeholder,
  className,
  includedRegionCodes,
  includedPrimaryTypes,
}: PlaceAutocompleteInputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const elementRef = useRef<any>(null);
  // Ref mirror of the latest onChange/onPlaceSelect — the mount effect
  // below intentionally runs ONCE (mirrors the same reasoning as the
  // admin map effects: mounting the custom element twice on every
  // parent re-render would be wrong), so it reads callbacks via refs
  // rather than closing over props that go stale.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onPlaceSelectRef = useRef(onPlaceSelect);
  onPlaceSelectRef.current = onPlaceSelect;

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey || !containerRef.current) return;
    let cancelled = false;

    loadGoogleMapsScript(apiKey)
      .then(() => {
        if (cancelled || !containerRef.current || elementRef.current) return;
        const google = (window as any).google;

        const el = new google.maps.places.PlaceAutocompleteElement({
          ...(includedRegionCodes ? { includedRegionCodes } : {}),
          ...(includedPrimaryTypes ? { includedPrimaryTypes } : {}),
        });

        // Documented supported override points only — see comment
        // above on why this doesn't try to reach further into the
        // closed shadow root.
        el.style.width = "100%";
        el.style.border = "none";
        el.style.background = "transparent";
        el.style.font = "inherit";

        if (placeholder) el.placeholder = placeholder;
        if (value) el.value = value;

        el.addEventListener("gmp-select", async (e: any) => {
          const place = e.placePrediction.toPlace();
          await place.fetchFields({
            fields: ["formattedAddress", "location", "addressComponents"],
          });

          const location = place.location
            ? { lat: place.location.lat(), lng: place.location.lng() }
            : null;

          onChangeRef.current(place.formattedAddress ?? el.value ?? "");
          onPlaceSelectRef.current?.({
            formattedAddress: place.formattedAddress ?? null,
            location,
            addressComponents: place.addressComponents ?? null,
          });
        });

        // Free typing WITHOUT picking a suggestion must still reach
        // the parent's form state (same behavior the old Autocomplete
        // supported — a user could type and submit without ever
        // opening the dropdown). PlaceAutocompleteElement is a real
        // form-associated custom element with its own `value`
        // property; it dispatches a standard, bubbling `input` event
        // on itself as the user types, same contract as a native
        // <input>, so this listener is exactly what a plain
        // onChange={...} would do for a normal input.
        el.addEventListener("input", () => {
          onChangeRef.current(el.value ?? "");
        });

        containerRef.current.appendChild(el);
        elementRef.current = el;
      })
      .catch(() => {
        // Silent — same graceful-degradation approach as every other
        // Maps integration in this codebase (see mapsLoadError in
        // listing-create-form.tsx). No fallback plain-text input here
        // specifically because this component has no visible "loading
        // failed" state of its own; callers needing that (e.g. the
        // create form's address field, the search pill) already show
        // their own error messaging around whatever they render.
      });

    return () => {
      cancelled = true;
    };
    // Mount-once, same reasoning as every other imperative Maps effect
    // in this codebase (listing-create-form.tsx's own map/autocomplete
    // effect) — restriction props (includedRegionCodes/includedPrimaryTypes)
    // are static per call site in this codebase, never changed after
    // mount, so re-running this on their change isn't needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the element's displayed value in sync with external changes
  // to `value` (e.g. a parent's form.reset() in edit mode, or the
  // search pill syncing from the URL's search params) — the mount
  // effect above only sets the INITIAL value once.
  useEffect(() => {
    if (elementRef.current && elementRef.current.value !== value) {
      elementRef.current.value = value;
    }
  }, [value]);

  return <div ref={containerRef} className={className} />;
}
