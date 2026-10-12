import type { NextRequest } from "next/server";

import {
  API_URL,
  backendUnreachable,
  crossSiteRefused,
  forwardedFor,
  isCrossSite,
  sessionFromLoginResponse,
} from "@/lib/auth-cookies";

// POST /api/auth/google: Google sign-in and sign-up.
//
// Same job as ../login/route.ts for Google: the browser posts the Google
// ID token (plus the optional role picked at sign-up) here, Django checks
// it server-side (POST /accounts/login/google/), and the session tokens it
// returns become httpOnly cookies instead of going back to the browser.
export async function POST(request: NextRequest) {
  if (isCrossSite(request)) return crossSiteRefused();

  let djangoRes: Response;
  try {
    djangoRes = await fetch(`${API_URL}/accounts/login/google/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...forwardedFor(request) },
      body: await request.text(),
      cache: "no-store",
    });
  } catch {
    return backendUnreachable();
  }
  return sessionFromLoginResponse(djangoRes);
}
