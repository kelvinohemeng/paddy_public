"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMapsScript } from "@/lib/google-maps";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Custom Places autocomplete — a plain <input> plus a hand-rolled
// suggestions dropdown, deliberately NOT google's
// <gmp-place-autocomplete> custom element.
//
// Why: PlaceAutocompleteElement owns a CLOSED shadow root and paints
// its own search/magnifier icon inside it. Closed means no CSS,
// parts, or slots reach that icon — it can't be hidden or restyled
// from outside. The Figma search pill calls for a bare text input
// with no icon, so this component skips the element entirely and
// talks to the Places suggestion APIs directly, then Place.fetchFields
// (or Geocoder as fallback) for details on pick. Same onChange /
// onPlaceSelect contract as before, so existing callers (search pill,
// listing-create-form) don't change.
//
// Worldwide by default: no region/type restrictions unless the caller
// passes includedRegionCodes / includedPrimaryTypes explicitly.

export type PlaceDetails = {
  formattedAddress: string | null;
  location: { lat: number; lng: number } | null;
  addressComponents: Array<{ longText: string; shortText: string; types: string[] }> | null;
};

type Suggestion = {
  id: string;
  primaryText: string;
  secondaryText: string;
  // New-API placePrediction (has .toPlace()) — null for legacy
  // AutocompleteService predictions, which carry a placeId instead.
  raw: any | null;
  legacyPlaceId: string | null;
};

type PlaceAutocompleteInputProps = {
  value: string;
  onChange: (value: string) => void;
  onPlaceSelect?: (place: PlaceDetails) => void;
  placeholder?: string;
  className?: string;
  /** Extra classes for the <input> itself (the wrapper gets className). */
  inputClassName?: string;
  /** "field" (default): a normal bordered form input. "bare": no border,
   *  padding or ring — for hosts that draw their own frame (the search
   *  pill). */
  appearance?: "field" | "bare";
  /** Forwarded to the <input>, so a <label htmlFor> can point at it. */
  id?: string;
  // Optional Places (New) restrictions. Omit entirely for worldwide
  // results — the search pill intentionally passes none.
  includedRegionCodes?: string[];
  includedPrimaryTypes?: string[];
};

export function PlaceAutocompleteInput({
  value,
  onChange,
  onPlaceSelect,
  placeholder,
  className,
  inputClassName,
  appearance = "field",
  id,
  includedRegionCodes,
  includedPrimaryTypes,
}: PlaceAutocompleteInputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapsReady, setMapsReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const requestIdRef = useRef(0);
  const sessionTokenRef = useRef<any>(null);
  // Set right before committing a pick: the resulting controlled-value
  // change must NOT trigger a fresh suggestion fetch (which would pop
  // the dropdown back open and could overwrite the picked text).
  const suppressFetchRef = useRef(false);

  // Ref mirrors so the debounced fetch never closes over stale props.
  // Synced in effects (not during render) per react-hooks/refs.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const onPlaceSelectRef = useRef(onPlaceSelect);
  useEffect(() => {
    onPlaceSelectRef.current = onPlaceSelect;
  }, [onPlaceSelect]);
  const restrictionsRef = useRef({ includedRegionCodes, includedPrimaryTypes });
  useEffect(() => {
    restrictionsRef.current = { includedRegionCodes, includedPrimaryTypes };
  }, [includedRegionCodes, includedPrimaryTypes]);

  // Load the Maps JS SDK once, then explicitly import the Places
  // library. The bootstrap `libraries=places` script tag alone does
  // NOT expose AutocompleteSuggestion on google.maps.places — the New
  // APIs only appear after `importLibrary("places")`. Skipping that
  // call was why the dropdown silently never populated.
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) return;
    let cancelled = false;
    loadGoogleMapsScript(apiKey)
      .then(async () => {
        try {
          const google = (window as any).google;
          if (google?.maps?.importLibrary) {
            await google.maps.importLibrary("places");
          }
        } catch {
          // importLibrary failing just means the New API is
          // unavailable — the legacy AutocompleteService fallback in
          // the fetch effect still works.
        }
        if (!cancelled) setMapsReady(true);
      })
      .catch(() => {
        // Silent — callers already degrade to free-text input when
        // suggestions can't load; typing + submit still works.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced suggestion fetch on the controlled value. All state
  // updates live inside the timeout callback (never the effect body
  // directly) so no synchronous setState-in-effect cascade.
  useEffect(() => {
    if (!mapsReady) return;
    // A pick just committed this value — swallow this cycle so the
    // dropdown stays closed on the picked text.
    if (suppressFetchRef.current) {
      suppressFetchRef.current = false;
      return;
    }
    const query = value.trim();

    const timer = setTimeout(() => {
      if (!query) {
        setSuggestions([]);
        setOpen(false);
        setActiveIndex(-1);
        return;
      }

      void (async () => {
        const google = (window as any).google;
        if (!google?.maps) return;

        const requestId = ++requestIdRef.current;
        setLoading(true);
        try {
          const { includedRegionCodes: regions, includedPrimaryTypes: types } =
            restrictionsRef.current;

          // --- Path 1: Places (New) AutocompleteSuggestion ---
          let placesLib: any = null;
          try {
            placesLib = google.maps.importLibrary
              ? await google.maps.importLibrary("places")
              : google.maps.places;
          } catch {
            placesLib = google.maps.places;
          }
          const SuggestionApi =
            placesLib?.AutocompleteSuggestion ??
            google.maps.places?.AutocompleteSuggestion;

          if (SuggestionApi?.fetchAutocompleteSuggestions) {
            if (!sessionTokenRef.current && placesLib?.AutocompleteSessionToken) {
              try {
                sessionTokenRef.current =
                  new placesLib.AutocompleteSessionToken();
              } catch {
                sessionTokenRef.current = null;
              }
            }
            const result = await SuggestionApi.fetchAutocompleteSuggestions({
              input: query,
              ...(sessionTokenRef.current
                ? { sessionToken: sessionTokenRef.current }
                : {}),
              ...(regions ? { includedRegionCodes: regions } : {}),
              ...(types ? { includedPrimaryTypes: types } : {}),
            });
            if (requestIdRef.current !== requestId) return;

            const rawList: any[] = result?.suggestions ?? [];
            const parsed: Suggestion[] = rawList
              .map((s, i): Suggestion | null => {
                const prediction = s?.placePrediction ?? s;
                if (!prediction?.toPlace) return null;
                const text =
                  prediction?.text?.text ??
                  prediction?.structuredFormat?.mainText?.text ??
                  "";
                if (!text) return null;
                return {
                  id: prediction?.placeId ?? `${text}-${i}`,
                  primaryText:
                    prediction?.structuredFormat?.mainText?.text ?? text,
                  secondaryText:
                    prediction?.structuredFormat?.secondaryText?.text ?? "",
                  raw: prediction,
                  legacyPlaceId: null,
                } satisfies Suggestion;
              })
              .filter((s): s is Suggestion => s !== null);

            setSuggestions(parsed);
            setOpen(parsed.length > 0);
            setActiveIndex(-1);
            return;
          }

          // --- Path 2: legacy AutocompleteService fallback ---
          // Covers keys/projects without the Places (New) API enabled.
          const Service = google.maps.places?.AutocompleteService;
          if (Service) {
            const service = new Service();
            const predictions = await new Promise<any[]>((resolve) => {
              service.getPlacePredictions(
                {
                  input: query,
                  ...(regions?.length
                    ? { componentRestrictions: { country: regions } }
                    : {}),
                  // Legacy has no exact "locality" equivalent that
                  // matches the New types; leave types unset so
                  // neighborhoods/streets aren't hidden.
                },
                (results: any[] | null) => resolve(results ?? []),
              );
            });
            if (requestIdRef.current !== requestId) return;

            const parsed: Suggestion[] = predictions
              .map((p, i): Suggestion | null => {
                const text: string =
                  p?.structured_formatting?.main_text ?? p?.description ?? "";
                if (!text) return null;
                return {
                  id: p?.place_id ?? `${text}-${i}`,
                  primaryText: text,
                  secondaryText:
                    p?.structured_formatting?.secondary_text ?? "",
                  raw: null,
                  legacyPlaceId: p?.place_id ?? null,
                } satisfies Suggestion;
              })
              .filter((s): s is Suggestion => s !== null);

            setSuggestions(parsed);
            setOpen(parsed.length > 0);
            setActiveIndex(-1);
            return;
          }

          // No suggestion API available at all — leave free-text mode.
          if (requestIdRef.current === requestId) {
            setSuggestions([]);
            setOpen(false);
          }
        } catch {
          // Per-keystroke failures (quota, network blip) stay silent —
          // the user can still submit free text.
          if (requestIdRef.current === requestId) {
            setSuggestions([]);
            setOpen(false);
          }
        } finally {
          if (requestIdRef.current === requestId) setLoading(false);
        }
      })();
    }, 250);

    return () => clearTimeout(timer);
  }, [mapsReady, value]);

  // Click-outside closes the dropdown.
  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  async function selectSuggestion(suggestion: Suggestion) {
    // Claim the next value-change cycle BEFORE any onChange below so
    // the committed pick never re-triggers a fetch, even if the
    // details lookup is slow or throws.
    suppressFetchRef.current = true;
    try {
      // New-API path: prediction → Place → details.
      if (suggestion.raw && typeof suggestion.raw.toPlace === "function") {
        const place = suggestion.raw.toPlace();
        await place.fetchFields({
          fields: ["formattedAddress", "location", "addressComponents"],
        });
        const location = place.location
          ? { lat: place.location.lat(), lng: place.location.lng() }
          : null;
        onChangeRef.current(
          place.formattedAddress ?? suggestion.primaryText,
        );
        onPlaceSelectRef.current?.({
          formattedAddress: place.formattedAddress ?? null,
          location,
          addressComponents: place.addressComponents ?? null,
        });
        // End the autocomplete session so billing groups correctly.
        sessionTokenRef.current = null;
        return;
      }

      // Legacy path: placeId → Places details. Uses PlacesService
      // (Places API, already enabled wherever AutocompleteService
      // works) — deliberately not Geocoder, which is a separately
      // enabled SKU and fails with "API key not authorized" on keys
      // without it.
      if (suggestion.legacyPlaceId) {
        const google = (window as any).google;
        const PlacesServiceCtor = google.maps.places?.PlacesService;
        if (!PlacesServiceCtor) {
          onChangeRef.current(suggestion.primaryText);
          return;
        }
        const service = new PlacesServiceCtor(
          document.createElement("div"),
        );
        const details = await new Promise<any>((resolve) => {
          service.getDetails(
            {
              placeId: suggestion.legacyPlaceId,
              fields: [
                "formatted_address",
                "geometry",
                "address_components",
              ],
            },
            (result: any) => resolve(result ?? null),
          );
        });
        const loc = details?.geometry?.location;
        onChangeRef.current(
          details?.formatted_address ?? suggestion.primaryText,
        );
        onPlaceSelectRef.current?.({
          formattedAddress: details?.formatted_address ?? null,
          location: loc ? { lat: loc.lat(), lng: loc.lng() } : null,
          addressComponents:
            details?.address_components?.map((c: any) => ({
              longText: c.long_name,
              shortText: c.short_name,
              types: c.types,
            })) ?? null,
        });
        return;
      }

      onChangeRef.current(suggestion.primaryText);
    } catch {
      // Details fetch failed — still commit the visible text so the
      // form isn't left empty.
      onChangeRef.current(suggestion.primaryText);
    } finally {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      {/* Plain text input — zero icons by design (Figma pill). */}
      <Input
        id={id}
        value={value}
        onChange={(e) => {
          onChangeRef.current(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!open || suggestions.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => (i + 1) % suggestions.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) =>
              i <= 0 ? suggestions.length - 1 : i - 1,
            );
          } else if (e.key === "Enter" && activeIndex >= 0) {
            e.preventDefault();
            void selectSuggestion(suggestions[activeIndex]);
          } else if (e.key === "Escape") {
            setOpen(false);
            setActiveIndex(-1);
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        className={cn(
          appearance === "bare" &&
            "border-0 bg-transparent px-0 shadow-none focus-visible:ring-0",
          inputClassName,
        )}
      />

      {open && (suggestions.length > 0 || loading) && (
        <ul
          role="listbox"
          className="bg-popover absolute top-full right-0 left-0 z-50 mt-2 overflow-hidden rounded-xl border shadow-md"
        >
          {loading && suggestions.length === 0 && (
            <li className="text-muted-foreground px-4 py-3 text-sm">
              Searching…
            </li>
          )}
          {suggestions.map((s, i) => (
            <li key={s.id} role="option" aria-selected={i === activeIndex}>
              <button
                type="button"
                // mousedown, not click: click fires after input blur
                // closes the list; preventDefault keeps focus so the
                // selection always lands.
                onMouseDown={(e) => {
                  e.preventDefault();
                  void selectSuggestion(s);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={cn(
                  "flex w-full flex-col gap-0.5 px-4 py-2.5 text-left transition-colors",
                  i === activeIndex ? "bg-muted" : "bg-transparent",
                )}
              >
                <span className="text-sm font-medium">{s.primaryText}</span>
                {s.secondaryText && (
                  <span className="text-muted-foreground text-xs">
                    {s.secondaryText}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
