"use client";

// Typed client for the backend's payments app (backend/payments/urls.py):
//   POST /payments/subscribe/            — start a plan checkout (new plan
//                                          or an agent ↔ lord switch)
//   GET  /payments/subscription/         — the landlord's plan + usage
//   POST /payments/subscription/cancel/  — stop the plan renewing
//   POST /payments/unlock-listing/       — start a one-time unlock checkout
//   GET  /payments/verify/?reference     — confirm a charge after Paystack redirects back
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

// GET /payments/subscription/ (backend payments/views.py my_subscription):
// LandlordSubscriptionSerializer fields — or, for a landlord who has never
// paid (no row yet), the fallback {tier: "free", status: "inactive",
// current_period_end: null, cancel_at_period_end: false} — PLUS the usage
// numbers from payments/limits.py usage_for(). Those numbers come from the
// SAME code that enforces the limits, so the subscription card shows them
// as-is and never counts listings itself (counting on the client is how
// the old card said "3 of 1 — limit reached" while the backend disagreed).
//
// POST /payments/subscription/cancel/ returns this same shape.
export type SubscriptionTier = "free" | "agent" | "lord";
// Every LandlordSubscription.Status value in payments/models.py.
export type SubscriptionStatus = "inactive" | "active" | "past_due";

export type LandlordSubscription = {
  id?: number;
  created_at?: string;
  // The tier on record. It can still say "agent" after an agent plan has
  // run out — compare with effective_tier to spot a lapsed plan.
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  current_period_end: string | null;
  // True once the landlord cancelled: no renewal, and no grace period —
  // the plan ends exactly at current_period_end.
  cancel_at_period_end: boolean;
  // When the paid plan stops counting: period end, plus 3 days' grace
  // unless cancelled. Null on Free.
  paid_access_ends_at: string | null;
  // The tier whose limits apply right now.
  effective_tier: SubscriptionTier;
  // Live listings (published + in review) and the live limit for
  // effective_tier. listing_cap null = unlimited (paddy lord).
  listings_used: number;
  listing_cap: number | null;
  // Listings hidden because the plan dropped below them; they come back
  // on their own when the landlord pays.
  listings_paused: number;
  listings_draft: number;
  // Free only (null on paid plans): every listing that counts toward the
  // Free plan's 10-listing total (archived and leased don't), and that
  // total's limit.
  listings_total: number | null;
  listing_total_cap: number | null;
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
// `cap` is the LIVE-listing limit (published + in review) and mirrors
// LandlordSubscription.LISTING_CAPS in payments/models.py (free: 3,
// agent: 10, lord: unlimited). It's only for describing a plan the
// landlord ISN'T on yet (the upgrade buttons) — their own current limit
// always comes from the API's listing_cap. Prices mirror the Paystack
// plans noted in config/settings.py (GHS 250/mo agent, GHS 1,000/mo lord)
// — the plan on Paystack's side is authoritative at charge time; these
// labels only exist to show humans what they're buying before checkout.
export const TIER_META: Record<
  SubscriptionTier,
  { label: string; cap: number | null; priceGhs: number | null }
> = {
  free: { label: "Free", cap: 3, priceGhs: null },
  agent: { label: "paddy agent", cap: 10, priceGhs: 250 },
  lord: { label: "paddy lord", cap: null, priceGhs: 1000 },
};

// ---- Errors ----
// DRF errors arrive as {error: "..."} or {detail: "..."} on these
// endpoints, some with a machine-readable `code` (already_on_plan,
// plan_change_pending, no_paid_plan, already_cancelled,
// email_not_verified). PaymentsError keeps the status and code so the UI
// can pick a friendly message by code instead of matching wording.
export class PaymentsError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function extractErrorMessage(data: unknown): string {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    if (typeof record.detail === "string") return record.detail;
  }
  return "Payment request failed";
}

async function toPaymentsError(res: Response): Promise<PaymentsError> {
  const body = await res.json().catch(() => ({}));
  const code =
    body && typeof body === "object" && typeof (body as { code?: unknown }).code === "string"
      ? (body as { code: string }).code
      : undefined;
  return new PaymentsError(extractErrorMessage(body), res.status, code);
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

// GET /payments/subscription/ — landlords only (403 for other roles).
export async function fetchMySubscription(): Promise<LandlordSubscription> {
  const res = await paymentsFetch("/payments/subscription/");
  if (!res.ok) throw await toPaymentsError(res);
  return res.json();
}

// POST /payments/subscribe/ — tier is "agent"|"lord"; amount must be sent in
// pesewas (the backend passes it straight to Paystack, whose plan then
// overrides it anyway — see the amount_kobo comment in initiate_subscription).
// callback_url is where Paystack sends the browser AFTER checkout completes;
// the page at that URL is what calls verifyPayment with the ?reference= param.
//
// Also how a landlord SWITCHES plan (agent ↔ lord): pay for the new one;
// the backend retires the old Paystack subscription once the new charge
// lands. Errors worth their own message (PaymentsError.code):
//   400 already_on_plan     — that tier is the one whose limits apply now
//   409 plan_change_pending — the last switch hasn't finished at Paystack
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
  if (!res.ok) throw await toPaymentsError(res);
  return res.json();
}

// POST /payments/subscription/cancel/ — stops the paid plan renewing at
// Paystack. The landlord keeps it until current_period_end (no grace
// after that), then drops to Free. Returns the updated subscription
// (same shape as fetchMySubscription). Errors (PaymentsError):
//   400 no_paid_plan / already_cancelled
//   502 — Paystack couldn't be reached; NOTHING changed, safe to retry
export async function cancelSubscription(): Promise<LandlordSubscription> {
  const res = await paymentsFetch("/payments/subscription/cancel/", {
    method: "POST",
  });
  if (!res.ok) throw await toPaymentsError(res);
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
  if (!res.ok) throw await toPaymentsError(res);
  return res.json();
}

// GET /payments/verify/?reference=...
export async function verifyPayment(reference: string): Promise<VerifyResponse> {
  const res = await paymentsFetch(
    `/payments/verify/?reference=${encodeURIComponent(reference)}`,
  );
  if (!res.ok) throw await toPaymentsError(res);
  return res.json();
}
