"use client";

import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { loadGoogleMapsScript, parseWktPoint } from "@/lib/google-maps";
import {
  DISCOVERY_MAP_SCOPE,
  DISCOVERY_MAP_SCOPE_OPTIONS,
} from "@/lib/discovery-map-config";
import { useConsent } from "@/providers/consent-provider";
import { MapPreviewCard } from "./map-preview-card";

const USER_LOCATION_ZOOM = 12;
// Fallback when the visitor's location isn't available.
const ACCRA_CENTER = { lat: 5.6037, lng: -0.187 };
// How long to wait on the location permission prompt before falling
// back to Accra.
const LOCATION_WAIT_MS = 10_000;
const SEARCH_FOCUS_ZOOM = 11;
// How much wider than the searched place's own viewport to frame —
// ~1.5 zoom levels out, so listings around the area stay in view
// instead of a pin-tight crop.
const SEARCH_VIEWPORT_PAD_FACTOR = 2.5;
// Minimum frame (~25km) so street-level results still land on an
// area view, not a rooftop close-up.
const SEARCH_MIN_LAT_SPAN = 0.25;

export type MapListing = {
  id: number | string;
  slug?: string;
  title: string;
  location: string | null;
  price_monthly: string | null;
  price_one_time: string | null;
  listing_type: "rent" | "buy";
  photos?: any[];
  city?: string;
  neighborhood?: string;
};

type DiscoveryMapProps = {
  listings: MapListing[];
  hoveredId: number | string | null;
  onMarkerClick: (id: number | string) => void;
  onMarkerHover: (id: number | string | null) => void;
  onVisibleListingsChange: (ids: Array<number | string>) => void;
  onPoiClick: (place: MapPlacePreview) => void;
  selectedListing: MapListing | null;
  selectedPoi: MapPlacePreview | null;
  onClosePreview: () => void;
  // Free-text / city query from the search pill (server-read `city`
  // param, threaded through DiscoverySplitView). When present the map
  // looks it up and pans/zooms there — a submitted search literally
  // moves the map to that location.
  searchFocus?: string | null;
};

export type MapPlacePreview = {
  id: string;
  name: string;
  address: string | null;
  category: string | null;
  rating: number | null;
  photoUrl: string | null;
  googleMapsUri: string | null;
  position: { lat: number; lng: number };
};

function formatPillPrice(listing: MapListing): string {
  const raw =
    listing.listing_type === "buy"
      ? listing.price_one_time
      : listing.price_monthly;
  if (!raw) return "•";
  const num = Number(raw);
  if (Number.isNaN(num)) return "•";
  if (num >= 1000) return `${(num / 1000).toFixed(num % 1000 === 0 ? 0 : 1)}K`;
  return num.toString();
}

function listingPinContent(listing: MapListing) {
  const content = document.createElement("div");
  content.textContent = formatPillPrice(listing);
  content.title = listing.title;
  Object.assign(content.style, {
    alignItems: "center",
    background: "#fff",
    border: "1.5px solid #e5e7eb",
    boxShadow:
      "0 1px 3px 0 rgba(0, 0, 0, 0.2), 0 1px 2px 0 rgba(0, 0, 0, 0.05)",
    borderRadius: "999px",
    color: "black",
    display: "flex",
    fontSize: "12px",
    fontWeight: "600",
    height: "28px",
    justifyContent: "center",
    padding: "0 12px",
    whiteSpace: "nowrap",
    cursor: "pointer",
    transition: "all 0.15s ease",
  });
  return content;
}

export function DiscoveryMap({
  listings,
  hoveredId,
  onMarkerClick,
  onMarkerHover,
  onVisibleListingsChange,
  onPoiClick,
  selectedListing,
  selectedPoi,
  onClosePreview,
  searchFocus,
}: DiscoveryMapProps) {
  const [isCentering, setIsCentering] = useState(true);
  // Mirrors isCentering for callbacks: fallbacks only move the camera
  // while the map is still hidden, never once the visitor can see it.
  const centeredRef = useRef(false);
  const finishCentering = () => {
    centeredRef.current = true;
    setIsCentering(false);
  };

  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const infoWindowRef = useRef<any>(null);
  const infoWindowContentRef = useRef<HTMLDivElement | null>(null);
  const infoWindowRootRef = useRef<Root | null>(null);
  const listingMarkersRef = useRef<Map<number | string, any>>(new Map());
  const prevVisibleIdsRef = useRef<string>("");

  // Keep callback refs updated to avoid stale closure references
  const onClosePreviewRef = useRef(onClosePreview);
  const onMarkerClickRef = useRef(onMarkerClick);
  const onMarkerHoverRef = useRef(onMarkerHover);
  const onVisibleListingsChangeRef = useRef(onVisibleListingsChange);
  const onPoiClickRef = useRef(onPoiClick);

  useEffect(() => {
    onClosePreviewRef.current = onClosePreview;
    onMarkerClickRef.current = onMarkerClick;
    onMarkerHoverRef.current = onMarkerHover;
    onVisibleListingsChangeRef.current = onVisibleListingsChange;
    onPoiClickRef.current = onPoiClick;
  });

  const [loadError, setLoadError] = useState<string | null>(() =>
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
      ? null
      : "Map unavailable — Google Maps API key is not configured.",
  );
  const [mapReady, setMapReady] = useState(false);
  const [markersReadyCount, setMarkersReadyCount] = useState(0);
  const { consent } = useConsent();

  // --- 1. Initialize Map ---
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) return;
    let cancelled = false;

    loadGoogleMapsScript(apiKey)
      .then(() => {
        if (cancelled || !mapDivRef.current || mapRef.current) return;
        const google = (window as any).google;
        const scope = DISCOVERY_MAP_SCOPE_OPTIONS[DISCOVERY_MAP_SCOPE];
        const map = new google.maps.Map(mapDivRef.current, {
          center: scope.center,
          zoom: scope.zoom,
          ...(scope.restriction ? { restriction: scope.restriction } : {}),
          mapId: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID",
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          gestureHandling: "greedy",
          clickableIcons: true,
        });
        mapRef.current = map;

        infoWindowRef.current = new google.maps.InfoWindow({
          pixelOffset: new google.maps.Size(0, 0),
          headerDisabled: true,
          className: "custom-map-info-window",
        });

        infoWindowContentRef.current = document.createElement("div");
        infoWindowRootRef.current = createRoot(infoWindowContentRef.current);

        infoWindowRef.current.addListener("closeclick", () =>
          onClosePreviewRef.current(),
        );

        setMapReady(true);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Could not load Google Maps.");
      });

    return () => {
      cancelled = true;
      // Deferred, not synchronous: unmounting this root inline can
      // collide with an in-progress render of the surrounding tree
      // (React: "attempted to synchronously unmount a root while React
      // was already rendering"). A microtask runs after the current
      // render/commit completes, so the teardown never re-enters a
      // render. The ref is cleared immediately so no new render() can
      // target the dying root in between.
      const root = infoWindowRootRef.current;
      infoWindowRootRef.current = null;
      if (root) {
        queueMicrotask(() => root.unmount());
      }
    };
  }, []);

  // --- 2. User Location ---
  // The map stays behind the skeleton until it has somewhere to be:
  // the visitor's location if they allow it, Accra if they deny it,
  // it errors, or the browser has no geolocation.
  //
  // Yields to an explicit search: if the visitor submitted a Where
  // query, the search-focus effect below owns the camera (and clears
  // the skeleton) — centering on the user here would fight it.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || searchFocus?.trim()) return;

    let settled = false;
    const settle = (center: { lat: number; lng: number }) => {
      if (settled) return;
      settled = true;
      map.setCenter(center);
      map.setZoom(USER_LOCATION_ZOOM);
      finishCentering();
    };
    const fallbackToAccra = () => settle(ACCRA_CENTER);

    if (!navigator.geolocation) {
      // Deferred: no synchronous setState inside the effect body.
      const t = setTimeout(fallbackToAccra, 0);
      return () => clearTimeout(t);
    }

    // The browser's own `timeout` only starts once permission is
    // granted — a visitor who ignores the prompt would otherwise sit
    // on the skeleton forever. After this long, show Accra; a late
    // "Allow" is ignored so the map never jumps while they browse.
    const guard = setTimeout(fallbackToAccra, LOCATION_WAIT_MS);

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => settle({ lat: coords.latitude, lng: coords.longitude }),
      fallbackToAccra, // denied, unavailable, or timed out
      {
        enableHighAccuracy: false, // area-level is plenty for a map view
        maximumAge: 5 * 60 * 1000, // a recent fix is fine; skips the wait
        timeout: 8000,
      },
    );

    return () => {
      settled = true;
      clearTimeout(guard);
    };
  }, [mapReady, searchFocus]);

  // --- 2b. Search focus — pan/zoom to the submitted Where query ---
  // Resolved via Places Text Search, deliberately NOT Geocoder: the
  // Geocoding API is a separately-enabled SKU and keys without it get
  // "This API key is not authorized to use this service" — while the
  // Places API is guaranteed present wherever autocomplete already
  // works. Same camera behavior: viewport fit when available (zooms
  // to the place's natural scale — country vs. city vs. street),
  // pin-drop fallback otherwise.
  useEffect(() => {
    const map = mapRef.current;
    const query = searchFocus?.trim();
    if (!mapReady || !map || !query) return;

    let cancelled = false;
    // Whatever happens below, the skeleton must come down; a lookup
    // that finds nothing (or fails) lands on Accra rather than leaving
    // the map at its whole-world starting view.
    const fallbackToAccra = () => {
      if (centeredRef.current) return;
      map.setCenter(ACCRA_CENTER);
      map.setZoom(USER_LOCATION_ZOOM);
    };
    void (async () => {
      const google = (window as any).google;
      try {
        const placesLib = google?.maps?.importLibrary
          ? await google.maps.importLibrary("places")
          : google?.maps?.places;
        const PlaceCtor = placesLib?.Place ?? google?.maps?.places?.Place;
        if (!PlaceCtor?.searchByText) {
          fallbackToAccra();
          return;
        }

        const { places } = await PlaceCtor.searchByText({
          textQuery: query,
          fields: ["location", "viewport"],
          maxResultCount: 1,
        });
        if (cancelled) return;
        const top = places?.[0];
        if (!top) {
          fallbackToAccra();
          return;
        }
        if (top.viewport) {
          // Padded fit: the raw viewport hugs the place itself, so
          // frame a wider area around it — nearby listings stay
          // visible in the grid instead of cropping to one pin.
          const LatLngBoundsCtor = google.maps.LatLngBounds;
          const vp = top.viewport;
          if (LatLngBoundsCtor && vp?.getCenter) {
            const center = vp.getCenter();
            const ne = vp.getNorthEast();
            const sw = vp.getSouthWest();
            const latSpan = Math.max(
              (ne.lat() - sw.lat()) * SEARCH_VIEWPORT_PAD_FACTOR,
              SEARCH_MIN_LAT_SPAN,
            );
            const lngSpan = Math.max(
              (ne.lng() - sw.lng()) * SEARCH_VIEWPORT_PAD_FACTOR,
              SEARCH_MIN_LAT_SPAN,
            );
            const clampLat = (v: number) => Math.min(85, Math.max(-85, v));
            const wrapLng = (v: number) => ((v + 540) % 360) - 180;
            map.fitBounds(
              new LatLngBoundsCtor(
                {
                  lat: clampLat(center.lat() - latSpan / 2),
                  lng: wrapLng(center.lng() - lngSpan / 2),
                },
                {
                  lat: clampLat(center.lat() + latSpan / 2),
                  lng: wrapLng(center.lng() + lngSpan / 2),
                },
              ),
            );
          } else {
            map.fitBounds(vp);
          }
        } else if (top.location) {
          map.panTo(top.location);
          map.setCenter(top.location);
          map.setZoom(SEARCH_FOCUS_ZOOM);
        }
      } catch {
        // Lookup failures (quota, network blip) stay silent — no error
        // state, just the Accra view.
        if (!cancelled) fallbackToAccra();
      } finally {
        if (!cancelled) finishCentering();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mapReady, searchFocus]);

  // --- 3. Click Listeners (POIs & Blank Map Space) ---
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    const clickListener = map.addListener("click", async (event: any) => {
      // FIX 3: Clicking blank map space closes open preview card
      if (!event.placeId) {
        onClosePreviewRef.current();
        return;
      }

      event.stop();
      const google = (window as any).google;
      const { Place } = await google.maps.importLibrary("places");
      const place = new Place({ id: event.placeId });
      await place.fetchFields({
        fields: [
          "displayName",
          "formattedAddress",
          "googleMapsURI",
          "photos",
          "primaryType",
          "rating",
        ],
      });

      const photo = place.photos?.[0];
      onPoiClickRef.current({
        id: place.id,
        name: place.displayName || "Nearby place",
        address: place.formattedAddress || null,
        category: place.primaryType || null,
        rating: place.rating || null,
        photoUrl: photo?.getURI({ maxWidth: 640 }) || null,
        googleMapsUri: place.googleMapsURI || null,
        position: { lat: event.latLng.lat(), lng: event.latLng.lng() },
      });
    });

    return () => clickListener.remove();
  }, [mapReady]);

  // --- 4. Marker Creation Effect ---
  useEffect(() => {
    const google = (window as any).google;
    const map = mapRef.current;
    if (!google || !map || !mapReady) return;

    // 1. Clear old markers safely
    listingMarkersRef.current.forEach((marker) => {
      marker.map = null;
    });
    listingMarkersRef.current.clear();

    // 2. Loop over and paint new markers
    listings.forEach((listing) => {
      const point = parseWktPoint(listing.location);
      if (!point) return;

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: point,
        title: listing.title,
        content: listingPinContent(listing),
        gmpClickable: true,
      });

      marker.addEventListener("gmp-click", (e: any) => {
        if (e.domEvent) e.domEvent.stopPropagation();
        onMarkerClickRef.current(listing.id);
      });

      marker.content.addEventListener("mouseenter", () =>
        onMarkerHoverRef.current(listing.id),
      );
      marker.content.addEventListener("mouseleave", () =>
        onMarkerHoverRef.current(null),
      );

      listingMarkersRef.current.set(listing.id, marker);
    });

    // Recompute visibility immediately — redrawn markers with no
    // camera move fire no `idle`, so without this the grid keeps the
    // previous search's ids: stuck on a stale subset, or stuck empty
    // after clearing a search that returned nothing. Same dedupe as
    // the idle listener so redundant notifies are free.
    const bounds = map.getBounds();
    if (bounds) {
      const visibleIds: Array<number | string> = [];
      listingMarkersRef.current.forEach((marker, id) => {
        if (marker.position && bounds.contains(marker.position)) {
          visibleIds.push(id);
        }
      });
      const serialized = visibleIds.join(",");
      if (serialized !== prevVisibleIdsRef.current) {
        prevVisibleIdsRef.current = serialized;
        onVisibleListingsChangeRef.current(visibleIds);
      }
    }

    // Notify InfoWindow effect that markers are ready
    setMarkersReadyCount((prev) => prev + 1);
  }, [listings, mapReady]); // Only handles drawing markers when listings update

  // --- 5. Permanent Map Bounds / Viewport Listener ---
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    const updateVisibleListings = () => {
      const bounds = map.getBounds();
      if (!bounds) return;

      // Scan all drawn markers instead of relying on a closed-over listings sub-map
      const visibleIds: Array<number | string> = [];
      listingMarkersRef.current.forEach((marker, id) => {
        if (marker.position && bounds.contains(marker.position)) {
          visibleIds.push(id);
        }
      });

      const serialized = visibleIds.join(",");
      if (serialized !== prevVisibleIdsRef.current) {
        prevVisibleIdsRef.current = serialized;
        onVisibleListingsChangeRef.current(visibleIds);
      }
    };

    // Attach listener once; it stays alive across listing state updates
    const idleListener = map.addListener("idle", updateVisibleListings);

    return () => {
      idleListener.remove();
    };
  }, [mapReady]); // Run ONCE on map ready

  // --- 6. Manage InfoWindow Position & Content ---
  useEffect(() => {
    const infoWindow = infoWindowRef.current;
    const map = mapRef.current;
    const root = infoWindowRootRef.current;
    const contentDiv = infoWindowContentRef.current;
    const google = (window as any).google;

    if (!mapReady || !map || !infoWindow || !root || !contentDiv || !google)
      return;

    // ALWAYS close first to detach any previous anchor marker binding
    infoWindow.close();

    if (!selectedListing && !selectedPoi) return;

    infoWindow.setContent(contentDiv);
    root.render(
      <MapPreviewCard
        listing={selectedListing}
        poi={selectedPoi}
        onClose={() => onClosePreviewRef.current()}
      />,
    );

    // Check POI first (or active selection) to avoid stale listing state collisions
    if (selectedPoi) {
      infoWindow.setOptions({
        pixelOffset: new google.maps.Size(0, -24),
      });
      // `InfoWindow.open` does not accept a `position` option. Set it on the
      // InfoWindow itself so a previous listing-marker anchor cannot determine
      // where this POI preview is displayed.
      infoWindow.setPosition(selectedPoi.position);
      infoWindow.open({
        map,
        shouldFocus: false,
      });
    } else if (selectedListing) {
      const marker = listingMarkersRef.current.get(selectedListing.id);
      if (marker) {
        infoWindow.setOptions({
          pixelOffset: new google.maps.Size(0, -8),
        });
        // A listing uses its marker as the anchor; clear the prior POI
        // position before switching presentation modes.
        infoWindow.setPosition(null);
        infoWindow.open({ map, anchor: marker });
      }
    }
  }, [mapReady, selectedListing, selectedPoi, markersReadyCount]);

  // --- 7. Hover & Selected Pin Highlight ---
  useEffect(() => {
    const google = (window as any).google;
    if (!google) return;

    listingMarkersRef.current.forEach((marker, id) => {
      if (!marker.content) return;
      const isSelected = selectedListing?.id === id;
      const isHovered = hoveredId === id;

      if (isSelected || isHovered) {
        marker.content.style.background = "#0f766e";
        marker.content.style.color = "#ffffff";
        marker.content.style.borderColor = "#0f766e";
        marker.zIndex = 1000;
      } else {
        marker.content.style.background = "#ffffff";
        marker.content.style.color = "#000000";
        marker.content.style.borderColor = "#e5e7eb";
        marker.zIndex = 1;
      }
    });
  }, [hoveredId, selectedListing]);

  if (loadError)
    return (
      <div className="bg-muted flex h-full w-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {loadError}
      </div>
    );

  return (
    <div className="relative h-full w-full">
      <div ref={mapDivRef} className="h-full w-full"></div>
      {/* Skeleton until the map knows where to be (see effect 2). It
          covers the live map, so the whole-world starting view is never
          seen. */}
      {isCentering && (
        <div
          role="status"
          aria-live="polite"
          className="bg-surface absolute inset-0 z-10 overflow-hidden"
        >
          {/* Faint road-like strokes so it reads as "a map is coming". */}
          <div className="absolute inset-0 animate-pulse">
            <div className="absolute top-[30%] -left-10 h-3 w-[70%] -rotate-6 rounded-full bg-black/5" />
            <div className="absolute top-[62%] left-[20%] h-3 w-[90%] rotate-3 rounded-full bg-black/5" />
            <div className="absolute top-0 left-[45%] h-full w-3 rotate-12 rounded-full bg-black/5" />
            <div className="absolute top-[18%] left-[62%] h-7 w-16 rounded-full bg-black/[0.07]" />
            <div className="absolute top-[48%] left-[22%] h-7 w-14 rounded-full bg-black/[0.07]" />
            <div className="absolute top-[72%] left-[58%] h-7 w-16 rounded-full bg-black/[0.07]" />
          </div>
          <p className="font-label absolute inset-x-0 bottom-6 text-center text-xs font-medium text-black/60">
            Finding homes near you…
          </p>
        </div>
      )}
    </div>
  );
}
