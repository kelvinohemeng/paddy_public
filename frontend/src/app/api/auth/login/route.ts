import type { NextRequest } from "next/server";

import {
  API_URL,
  backendUnreachable,
  crossSiteRefused,
  forwardedFor,
  isCrossSite,
  sessionFromLoginResponse,
} from "@/lib/auth-cookies";

// POST /api/auth/login: email + password sign-in.
//
// The sign-in form posts {email, password} here instead of straight to
// Django. This route passes them on to SimpleJWT's login endpoint
// (POST /accounts/login/) and, on success, stores the two tokens as
// httpOnly cookies (see lib/auth-cookies.ts). The browser gets {ok: true}
// back and never sees a token.
export async function POST(request: NextRequest) {
  // Stops another site from silently signing a visitor into an account
  // the attacker controls (login CSRF).
  if (isCrossSite(request)) return crossSiteRefused();

  let djangoRes: Response;
  try {
    djangoRes = await fetch(`${API_URL}/accounts/login/`, {
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
