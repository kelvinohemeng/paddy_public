// Feature flags. NEXT_PUBLIC_ values are inlined at build time, so a
// change needs a rebuild (or a dev-server restart).

// Viewings are hidden for the portfolio MVP: unset (or anything but
// "true") hides every viewing UI and line of copy. The backend's
// viewings endpoints are unchanged either way.
export const VIEWINGS_ENABLED = process.env.NEXT_PUBLIC_FEATURE_VIEWINGS === "true";
