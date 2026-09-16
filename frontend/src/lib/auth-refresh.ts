"use client";

import Cookies from "js-cookie";

// Client-side twin of the silent-refresh logic in src/proxy.ts.
//
// proxy.ts covers NAVIGATION (reload, link clicks, RSC requests): it
// refreshes the access cookie before the (admin) layout's live
// /accounts/me/ check runs. THIS module covers IN-APP fetches that go
// through the browser directly (dataProvider calls, the photo upload):
// on a 401 they call refreshAccessToken() once and retry.
//
// Kept as a separate module (not imported by proxy.ts) on purpose —
// Next's own docs warn against sharing modules between proxy and app
// code, so the tiny duplicated pieces there are deliberate, not drift.

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

export async function refreshAccessToken(): Promise<string | null> {
  // The refresh token is the ONLY credential that can mint a new
  // access token — it lives ~1 day (SimpleJWT default), far longer
  // than the 5-minute access token, which is exactly why silent
  // refresh works: short-lived access, long-lived refresh.
  const refresh = localStorage.getItem("refresh_token");
  if (!refresh) return null;

  try {
    const res = await fetch(`${API_URL}/accounts/login/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (!data.access) return null;

    // Write to BOTH stores — localStorage for direct client fetches,
    // cookie (path "/") for proxy.ts + server components. They must
    // never disagree about who's logged in, or the reload loop this
    // was built to fix comes straight back.
    localStorage.setItem("access_token", data.access);
    Cookies.set("access_token", data.access, { expires: 1, path: "/" });

    // Rotation is OFF on the backend by default (single response key:
    // `access`), but if ROTATE_REFRESH_TOKENS is ever enabled the
    // endpoint also returns a new `refresh` — handle it so the old
    // one doesn't silently die on the next rotation.
    if (data.refresh) {
      localStorage.setItem("refresh_token", data.refresh);
      Cookies.set("refresh_token", data.refresh, { expires: 1, path: "/" });
    }

    return data.access as string;
  } catch {
    // Network down etc. — caller treats null as "stay with the old
    // behavior" (surface the original 401), never as a logout signal.
    // Logging out on a network blip would be the wrong call.
    return null;
  }
}
