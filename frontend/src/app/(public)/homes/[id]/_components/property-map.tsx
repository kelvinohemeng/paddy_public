"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMapsScript, parseWktPoint } from "@/lib/google-maps";
import { cn } from "@/lib/utils";

const GHANA_DEFAULT_CENTER = { lat: 7.9465, lng: -1.0232 };
const PIN_ZOOM = 5;

// Single, static, non-interactive pin for a property detail page —
// deliberately simpler than DiscoveryMap (no hover sync, no multi-
// marker management): this page only ever shows ONE listing's
// location. If the listing has no location at all (allowed — see
// Listing.location's null=True), this renders nothing rather than a
// broken/empty map box.
export function PropertyMap({
  location,
  approximate = false,
  className = "h-64 rounded-md",
}: {
  location: string | null;
  // Locked listings: show a ~600m area circle instead of a pin, so the
  // map doesn't hand out the address the unlock fee pays for. (The API
  // still returns the exact point — that needs a backend fix too.)
  approximate?: boolean;
  // Height/rounding — the detail page's "Where you will be." block
  // (Figma 171:2655) is taller and rounder than the old default.
  className?: string;
}) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const point = parseWktPoint(location);

  useEffect(() => {
    if (!point) return;
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) return; // rendered as "Map unavailable." below
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
        if (approximate) {
          map.setZoom(14);
          new google.maps.Circle({
            map,
            center: point,
            radius: 600,
            strokeColor: "#18181b",
            strokeOpacity: 0.5,
            strokeWeight: 1,
            fillColor: "#18181b",
            fillOpacity: 0.12,
          });
          return;
        }
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
  }, [point?.lat, point?.lng, approximate]);

  if (!point) return null;

  const error = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    ? loadError
    : "Map unavailable.";

  if (error) {
    return (
      <div className={cn("bg-muted text-muted-foreground flex w-full items-center justify-center text-sm", className)}>
        {error}
      </div>
    );
  }

  return <div ref={mapDivRef} className={cn("w-full border", className)} />;
}
