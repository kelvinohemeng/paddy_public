// Shown when a city search matches nothing: the grid falls back to
// the unfiltered list (same price cap) so existing listings never
// vanish, and this notice says why. The map still pans to the
// searched place via searchFocus — browsing continues from there.

export function DiscoveryFallbackNotice({ city }: { city: string }) {
  return (
    <p className="bg-muted/50 rounded-xl border px-3 py-2 text-xs text-muted-foreground">
      No exact matches for &ldquo;{city}&rdquo; — showing all homes. Try
      a nearby city.
    </p>
  );
}
