// Shared Google Maps JS SDK loader. Deliberately NOT using a
// third-party React wrapper package.
let googleMapsScriptPromise: Promise<void> | null = null;

export function loadGoogleMapsScript(apiKey: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (
    (window as any).google?.maps?.places &&
    (window as any).google?.maps?.geometry &&
    (window as any).google?.maps?.marker
  ) {
    return Promise.resolve();
  }
  if (googleMapsScriptPromise) return googleMapsScriptPromise;

  googleMapsScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry,marker`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Maps script"));
    document.head.appendChild(script);
  });

  return googleMapsScriptPromise;
}

// Parses WKT/EWKT format "SRID=4326;POINT (lng lat)" serialized by GeoDjango.
export function parseWktPoint(
  wkt: string | null | undefined,
): { lat: number; lng: number } | null {
  if (!wkt) return null;
  const match = wkt.match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);
  if (!match) return null;
  return { lng: Number(match[1]), lat: Number(match[2]) };
}
