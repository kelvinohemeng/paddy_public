export type DiscoveryMapScope = "ghana" | "world";

// Change this one value to switch the discovery map's geographic scope.
// - "ghana": keeps the initial view and panning within Ghana.
// - "world": starts at a world view and allows unrestricted panning.
export const DISCOVERY_MAP_SCOPE: DiscoveryMapScope = "ghana";

const GHANA_CENTER = { lat: 7.9465, lng: -1.0232 };
const GHANA_BOUNDS = {
  north: 11.2,
  south: 4.5,
  east: 1.3,
  west: -3.5,
};

export const DISCOVERY_MAP_SCOPE_OPTIONS = {
  ghana: {
    center: GHANA_CENTER,
    zoom: 7,
    restriction: { latLngBounds: GHANA_BOUNDS, strictBounds: true },
  },
  world: {
    center: { lat: 0, lng: 0 },
    zoom: 2,
    restriction: undefined,
  },
} as const;

export const DISCOVERY_POI_CATEGORIES = [
  { label: "Hospitals", type: "hospital" },
  { label: "Schools", type: "school" },
  { label: "Parks", type: "park" },
  { label: "Supermarkets", type: "grocery_store" },
  { label: "Transit", type: "transit_station" },
] as const;

type MapVisibility = "on" | "off";

// Reference rules for a Cloud Map Style. A map using a Map ID (required for
// AdvancedMarkerElement) cannot also use the JavaScript `styles` option, so
// apply these same category choices in Google Cloud's Map Style editor.
export const DISCOVERY_MAP_POI_VISIBILITY: Record<string, MapVisibility> = {
  all: "off",
  business: "off",
  government: "off",
  medical: "off",
  park: "off",
  placeOfWorship: "off",
  school: "off",
  sportsComplex: "off",
  transitStations: "off",
};

const poiStyle = (featureType: string, visibility: MapVisibility) => ({
  featureType,
  stylers: [{ visibility }],
});

export const DISCOVERY_MAP_STYLES = [
  poiStyle("poi", DISCOVERY_MAP_POI_VISIBILITY.all),
  poiStyle("poi.business", DISCOVERY_MAP_POI_VISIBILITY.business),
  poiStyle("poi.government", DISCOVERY_MAP_POI_VISIBILITY.government),
  poiStyle("poi.medical", DISCOVERY_MAP_POI_VISIBILITY.medical),
  poiStyle("poi.park", DISCOVERY_MAP_POI_VISIBILITY.park),
  poiStyle("poi.place_of_worship", DISCOVERY_MAP_POI_VISIBILITY.placeOfWorship),
  poiStyle("poi.school", DISCOVERY_MAP_POI_VISIBILITY.school),
  poiStyle("poi.sports_complex", DISCOVERY_MAP_POI_VISIBILITY.sportsComplex),
  poiStyle("transit.station", DISCOVERY_MAP_POI_VISIBILITY.transitStations),
  { featureType: "water", elementType: "geometry.fill", stylers: [{ color: "#c8e0f4" }] },
  { featureType: "landscape", elementType: "geometry.fill", stylers: [{ color: "#f5f5f3" }] },
];

export function isWithinGhana({ lat, lng }: { lat: number; lng: number }) {
  return (
    lat >= GHANA_BOUNDS.south &&
    lat <= GHANA_BOUNDS.north &&
    lng >= GHANA_BOUNDS.west &&
    lng <= GHANA_BOUNDS.east
  );
}
