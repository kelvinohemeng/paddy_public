import { after, NextResponse, type NextRequest } from "next/server";

import {
  API_URL,
  clearAuthCookies,
  crossSiteRefused,
  isCrossSite,
  REFRESH_COOKIE,
} from "@/lib/auth-cookies";

// POST /api/auth/logout
//
// Two jobs:
//   1. Delete both cookies. That's what signs THIS browser out, and only
//      the server can do it now: browser JS can't touch httpOnly cookies.
//   2. Revoke the refresh token at Django (POST /accounts/logout/
//      blacklists it). Deleting the cookie alone would leave the token
//      valid for the rest of its ~1-day life for anyone holding a copy.
export async function POST(request: NextRequest) {
  // Without this check, any site could sign visitors out by posting here.
  if (isCrossSite(request)) return crossSiteRefused();

  // Read the token before the cookies are cleared below.
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;

  const response = NextResponse.json({ ok: true });
  clearAuthCookies(response);

  // after() runs once the response has gone out, so signing out never
  // waits on Django, which can take most of a minute to wake on Render's
  // free tier. Failures are ignored: a 400 means the token was already
  // dead, and a network error leaves things no worse than before.
  if (refresh) {
    after(async () => {
      try {
        await fetch(`${API_URL}/accounts/logout/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh }),
          cache: "no-store",
        });
      } catch {
        // see above
      }
    });
  }

  return response;
}
