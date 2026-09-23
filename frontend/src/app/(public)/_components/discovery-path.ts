// Canonical Discovery Hub route. The hub lived at `/` until it got
// its own route (hub at /homes, detail at /homes/[id]); every
// URL-as-state push in the discovery islands must target this, never
// a hardcoded "/" — one constant, zero drift.
export const DISCOVERY_PATH = "/homes";
