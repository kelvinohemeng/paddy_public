"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMapsScript, parseWktPoint } from "@/lib/google-maps";

const GHANA_DEFAULT_CENTER = { lat: 7.9465, lng: -1.0232 };
const PIN_ZOOM = 5;

// Single, static, non-interactive pin for a property detail page —
// deliberately simpler than DiscoveryMap (no hover sync, no multi-
// marker management): this page only ever shows ONE listing's
// location. If the listing has no location at all (allowed — see
// Listing.location's null=True), this renders nothing rather than a
// broken/empty map box.
export function PropertyMap({ location }: { location: string | null }) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const point = parseWktPoint(location);

  useEffect(() => {
    if (!point) return;
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      setLoadError("Map unavailable.");
      return;
    }
    let cancelled = false;

    loadGoogleMapsScript(apiKey)
      .then(() => {
        if (cancelled || !mapDivRef.current) return;
        const google = (window as any).google;
        const map = new google.maps.Map(mapDivRef.current, {
          center: point ?? GHANA_DEFAULT_CENTER,
          zoom: PIN_ZOOM,
          mapId: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID",
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          gestureHandling: "cooperative",
          // "cooperative" (Google's default), NOT "greedy" like the
          // hub's map — this map sits inside a long-scrolling detail
          // page, so it should NOT hijack page scroll on hover the way
          // a primary, full-height interaction surface reasonably can.
        });
        const pin = new google.maps.marker.PinElement();
        new google.maps.marker.AdvancedMarkerElement({
          map,
          position: point,
          content: pin.element,
        });
      })
      .catch(() => {
        if (!cancelled) setLoadError("Could not load the map.");
      });

    return () => {
      cancelled = true;
    };
  }, [point?.lat, point?.lng]);

  if (!point) return null;

  if (loadError) {
    return (
      <div className="bg-muted flex h-64 w-full items-center justify-center rounded-md text-sm text-muted-foreground">
        {loadError}
      </div>
    );
  }

  return <div ref={mapDivRef} className="h-64 w-full rounded-md border" />;
}
