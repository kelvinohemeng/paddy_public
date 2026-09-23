"use client";

// Typed client for the backend's payments app (backend/payments/urls.py):
//   POST /payments/subscribe/        — start a tier-upgrade checkout
//   GET  /payments/subscription/     — current landlord's tier/status/period
//   POST /payments/unlock-listing/   — start a one-time unlock checkout
//   GET  /payments/verify/?reference — confirm a charge after Paystack redirects back
//
// All of these are money-adjacent, so the shapes here mirror the backend
// EXACTLY as read from payments/views.py + payments/serializers.py — no
// defensive guessing beyond what the documented contract allows. Everything
// reuses dataProvider's customFetch pattern (Bearer from localStorage + one
// silent refresh + replay) because these calls have identical auth needs;
// importing that fetch directly would couple this module to the Refine data
// provider's lifecycle, so the same 401-refresh dance is reproduced here
// via the shared refreshAccessToken helper instead.

import { refreshAccessToken } from "@/lib/auth-refresh";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

// ---- Shapes (mirror the backend responses exactly) ----

// GET /payments/subscription/ — LandlordSubscriptionSerializer fields, plus
// the "never subscribed" fallback shape ({tier, status, period_end: null})
// my_subscription() returns when no row exists yet. `cap`/`used`/`remaining`
// are DERIVED client-side from LISTING_CAPS below — the backend does not
// return them, and deriving at read time mirrors AGENTS.md's "perks are
// derived from tier at read time, not stored as separate fields" rule.
export type SubscriptionTier = "free" | "agent" | "lord";
export type SubscriptionStatus = "inactive" | "active" | "past_due";

export type LandlordSubscription = {
  id?: number;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  current_period_end: string | null;
};

// POST /payments/subscribe/ and POST /payments/unlock-listing/ both return
// Paystack's Transaction initialize payload (result['data'] in the views):
export type PaystackInitResponse = {
  authorization_url: string;
  access_code: string;
  reference: string;
};

// GET /payments/verify/?reference=... — {verified, status} per verify_payment()
export type VerifyResponse = {
  verified: boolean;
  status: string;
};

// ---- Tier metadata (single source of truth for display values) ----
// Caps mirror LandlordSubscription.LISTING_CAPS in payments/models.py
// (free: 1, agent: 10, lord: unlimited). Prices mirror the Paystack plans
// noted in config/settings.py (GHS 250/mo agent, GHS 1,000/mo lord) — the
// plan on Paystack's side is authoritative at charge time; these labels
// only exist to show humans what they're buying before checkout.
export const TIER_META: Record<
  SubscriptionTier,
  { label: string; cap: number | null; priceGhs: number | null }
> = {
  free: { label: "Free", cap: 1, priceGhs: null },
  agent: { label: "paddy agent", cap: 10, priceGhs: 250 },
  lord: { label: "paddy lord", cap: null, priceGhs: 1000 },
};

// ---- Error shape: mirrors dataProvider's extractErrorMessage behavior ----
// DRF errors arrive as {error: "..."} or {detail: "..."} on these endpoints.
function extractErrorMessage(data: unknown): string {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    if (typeof record.detail === "string") return record.detail;
  }
  return "Payment request failed";
}

// ---- Shared fetch with the standard 401-refresh-retry dance ----
async function paymentsFetch(
  path: string,
  options: RequestInit = {},
  retried = false,
): Promise<Response> {
  const token = localStorage.getItem("access_token");
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
      Authorization: token ? `Bearer ${token}` : "",
    },
  });

  if (res.status === 401 && !retried) {
    const fresh = await refreshAccessToken();
    if (fresh) {
      return paymentsFetch(
        path,
        {
          ...options,
          headers: { ...options.headers, Authorization: `Bearer ${fresh}` },
        },
        true,
      );
    }
  }

  return res;
}

// ---- API calls ----

// GET /payments/subscription/
export async function fetchMySubscription(): Promise<LandlordSubscription> {
  const res = await paymentsFetch("/payments/subscription/");
  if (!res.ok) {
    throw new Error(extractErrorMessage(await res.json().catch(() => ({}))));
  }
  return res.json();
}

// POST /payments/subscribe/ — tier is "agent"|"lord"; amount must be sent in
// pesewas (the backend passes it straight to Paystack, whose plan then
// overrides it anyway — see the amount_kobo comment in initiate_subscription).
// callback_url is where Paystack sends the browser AFTER checkout completes;
// the page at that URL is what calls verifyPayment with the ?reference= param.
export async function startSubscriptionCheckout(params: {
  tier: Exclude<SubscriptionTier, "free">;
  callbackUrl: string;
}): Promise<PaystackInitResponse> {
  const res = await paymentsFetch("/payments/subscribe/", {
    method: "POST",
    body: JSON.stringify({
      tier: params.tier,
      amount_kobo: TIER_META[params.tier].priceGhs! * 100,
      callback_url: params.callbackUrl,
    }),
  });
  if (!res.ok) {
    throw new Error(extractErrorMessage(await res.json().catch(() => ({}))));
  }
  return res.json();
}

// POST /payments/unlock-listing/
export async function startUnlockCheckout(params: {
  listingId: number | string;
  callbackUrl: string;
}): Promise<PaystackInitResponse> {
  const res = await paymentsFetch("/payments/unlock-listing/", {
    method: "POST",
    body: JSON.stringify({
      listing_id: params.listingId,
      callback_url: params.callbackUrl,
    }),
  });
  if (!res.ok) {
    throw new Error(extractErrorMessage(await res.json().catch(() => ({}))));
  }
  return res.json();
}

// GET /payments/verify/?reference=...
export async function verifyPayment(reference: string): Promise<VerifyResponse> {
  const res = await paymentsFetch(
    `/payments/verify/?reference=${encodeURIComponent(reference)}`,
  );
  if (!res.ok) {
    throw new Error(extractErrorMessage(await res.json().catch(() => ({}))));
  }
  return res.json();
}
