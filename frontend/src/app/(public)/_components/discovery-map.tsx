"use client";

import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { loadGoogleMapsScript, parseWktPoint } from "@/lib/google-maps";
import {
  DISCOVERY_MAP_SCOPE,
  DISCOVERY_MAP_SCOPE_OPTIONS,
  isWithinGhana,
} from "@/lib/discovery-map-config";
import { useConsent } from "@/providers/consent-provider";
import { MapPreviewCard } from "./map-preview-card";

const USER_LOCATION_ZOOM = 12;

export type MapListing = {
  id: number | string;
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
}: DiscoveryMapProps) {
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
      : "Map unavailable — Google Maps API key is not configured."
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
          onClosePreviewRef.current()
        );

        setMapReady(true);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Could not load Google Maps.");
      });

    return () => {
      cancelled = true;
      infoWindowRootRef.current?.unmount();
      infoWindowRootRef.current = null;
    };
  }, []);

  // --- 2. User Location ---
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || consent !== "accepted" || !navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const location = { lat: coords.latitude, lng: coords.longitude };
        if (DISCOVERY_MAP_SCOPE === "world" || isWithinGhana(location)) {
          map.setCenter(location);
          map.setZoom(USER_LOCATION_ZOOM);
        }
      },
      () => {},
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 10_000 }
    );
  }, [consent, mapReady]);

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

  // --- 4. Render Listing Markers ---
  useEffect(() => {
    const google = (window as any).google;
    const map = mapRef.current;
    if (!google || !map) return;

    listingMarkersRef.current.forEach((marker) => {
      marker.map = null;
    });
    listingMarkersRef.current.clear();

    const listingPoints = new Map<number | string, any>();

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
        if (e.domEvent) {
          e.domEvent.stopPropagation();
        }
        onMarkerClickRef.current(listing.id);
      });

      marker.content.addEventListener("mouseenter", () =>
        onMarkerHoverRef.current(listing.id)
      );
      marker.content.addEventListener("mouseleave", () =>
        onMarkerHoverRef.current(null)
      );

      listingMarkersRef.current.set(listing.id, marker);
      listingPoints.set(listing.id, point);
    });

    // Notify InfoWindow effect that markers are ready
    setMarkersReadyCount((prev) => prev + 1);

    // FIX 4: Prevent duplicate triggers on map idle
    const updateVisibleListings = () => {
      const bounds = map.getBounds();
      if (!bounds) return;

      const visibleIds = Array.from(listingPoints.entries())
        .filter(([, point]) => bounds.contains(point))
        .map(([id]) => id);

      const serialized = visibleIds.join(",");
      if (serialized !== prevVisibleIdsRef.current) {
        prevVisibleIdsRef.current = serialized;
        onVisibleListingsChangeRef.current(visibleIds);
      }
    };

    const idleListener = map.addListener("idle", updateVisibleListings);
    return () => idleListener.remove();
  }, [listings, mapReady]);

  // --- 5. Manage InfoWindow Position & Content ---
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
      />
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

  // --- 6. Hover & Selected Pin Highlight ---
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

  return <div ref={mapDivRef} className="h-full w-full" />;
}
