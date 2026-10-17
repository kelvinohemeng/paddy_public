import type { SubscriptionTier } from "@/lib/payments";

// ---- Tier metadata (single source of truth for display values) ----
// Its own module, not in lib/payments.ts, because that file is
// "use client": a server component (the landing page's plans section)
// can't read a plain object exported from a client module.
// lib/payments.ts re-exports it, so client code imports it from there.
//
// `cap` is the LIVE-listing limit (published + in review) and mirrors
// LandlordSubscription.LISTING_CAPS in payments/models.py (free: 3,
// agent: 10, lord: unlimited). It's only for describing a plan the
// landlord ISN'T on yet (the upgrade buttons) — their own current limit
// always comes from the API's listing_cap. Prices mirror
// LandlordSubscription.PRICES_PESEWAS in payments/models.py (GHS 500/mo
// agent, GHS 1,000/mo lord), which the backend charges; these labels only
// show humans what they're buying before checkout.
export const TIER_META: Record<
  SubscriptionTier,
  { label: string; cap: number | null; priceGhs: number | null }
> = {
  free: { label: "Free", cap: 3, priceGhs: null },
  agent: { label: "paddy agent", cap: 10, priceGhs: 500 },
  lord: { label: "paddy lord", cap: null, priceGhs: 1000 },
};
