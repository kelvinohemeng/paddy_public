import { NextResponse } from "next/server";

import { SIGNED_IN_COOKIE } from "@/lib/session-hint";

// Server-only helpers for the httpOnly session cookies. Imported by the
// route handlers under app/api/ (login, Google login, logout, and the
// /api/backend proxy) and never by client code: the whole point is that
// browser JavaScript can't read the tokens, so only server code touches
// them.
//
// HOW AUTH WORKS NOW: Django still issues, checks and blacklists the JWTs
// (SimpleJWT, Bearer header only, unchanged). The Next server holds them:
// it sets them as httpOnly cookies on its OWN origin after login, and adds
// the Bearer header itself when it forwards a browser request to Django
// (app/api/backend/[...path]/route.ts). Server components keep reading the
// access_token cookie with cookies() as before, since httpOnly only hides
// a cookie from browser JS, not from the server.
//
// src/proxy.ts sets these same cookies when it refreshes a session on
// navigation. It keeps its own copy of the options on purpose (Next warns
// against sharing modules between proxy and app code), so keep the two in
// step.

export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";

export const API_URL = process.env.NEXT_PUBLIC_API_URL!;

// Both cookies live 1 day, the refresh token's own lifetime (SimpleJWT's
// default REFRESH_TOKEN_LIFETIME). The access token INSIDE its cookie dies
// after 5 minutes, but the cookie outlives it on purpose: its presence is
// what tells proxy.ts and the backend proxy "there's a session here, refresh
// it" instead of "nobody's logged in".
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24;

// Refresh while still valid but close to expiry, so a token never dies in
// the moment between this check and Django reading it.
const EXPIRY_SKEW_SECONDS = 30;

export function authCookieOptions(maxAge = COOKIE_MAX_AGE_SECONDS) {
  return {
    // The fix itself: browser JavaScript (including any injected script)
    // can't read an httpOnly cookie. The browser still attaches it to
    // every request to this origin.
    httpOnly: true,
    // HTTPS-only in production. Off in dev so http://localhost works.
    secure: process.env.NODE_ENV === "production",
    // "lax" = the browser leaves these cookies off requests that another
    // site starts (a hidden form POST from evil.example, say), except for
    // plain link clicks. That's the main CSRF protection; the backend
    // proxy adds a same-origin check on top.
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

// The readable "signed_in=1" hint (lib/session-hint.ts). Same settings as
// the session cookies except httpOnly, since browser code has to read it.
function signedInCookieOptions(maxAge = COOKIE_MAX_AGE_SECONDS) {
  return { ...authCookieOptions(maxAge), httpOnly: false };
}

export function setAuthCookies(
  response: NextResponse,
  tokens: { access: string; refresh?: string },
) {
  response.cookies.set(ACCESS_COOKIE, tokens.access, authCookieOptions());
  // Refresh responses only carry a new refresh token if
  // ROTATE_REFRESH_TOKENS is ever turned on in Django, so it's optional.
  // The hint is set with it, so the two always expire together.
  if (tokens.refresh) {
    response.cookies.set(REFRESH_COOKIE, tokens.refresh, authCookieOptions());
    response.cookies.set(SIGNED_IN_COOKIE, "1", signedInCookieOptions());
  }
}

export function clearAuthCookies(response: NextResponse) {
  // Same name, path and flags with maxAge 0 is what reliably deletes a
  // cookie (.delete()'s default path has changed between Next versions).
  response.cookies.set(ACCESS_COOKIE, "", authCookieOptions(0));
  response.cookies.set(REFRESH_COOKIE, "", authCookieOptions(0));
  response.cookies.set(SIGNED_IN_COOKIE, "", signedInCookieOptions(0));
}

// Reads the `exp` claim WITHOUT verifying the signature. That's fine here:
// it only decides whether to refresh early. Django verifies every token it
// receives, so a forged exp gains nothing.
function getTokenExpiry(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof json.exp === "number" ? json.exp : null;
  } catch {
    return null;
  }
}

export function isExpiredOrClose(token: string): boolean {
  const exp = getTokenExpiry(token);
  // Unreadable token: treat it as expired so we try a refresh rather than
  // sending garbage to Django.
  if (exp === null) return true;
  return exp - Math.floor(Date.now() / 1000) <= EXPIRY_SKEW_SECONDS;
}

export type RefreshResult =
  | { status: "ok"; access: string; refresh?: string }
  // Django said no (401/400): the refresh token expired or was
  // blacklisted by a logout. The session is over.
  | { status: "invalid" }
  // Django couldn't be reached or broke (network error, 5xx). Never treat
  // this as a logout: a network blip mustn't sign anyone out.
  | { status: "unreachable" };

export async function refreshTokens(refresh: string): Promise<RefreshResult> {
  try {
    const res = await fetch(`${API_URL}/accounts/login/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
      cache: "no-store",
    });
    if (res.status === 400 || res.status === 401) return { status: "invalid" };
    if (!res.ok) return { status: "unreachable" };
    const data = await res.json();
    if (typeof data.access !== "string") return { status: "unreachable" };
    return { status: "ok", access: data.access, refresh: data.refresh };
  } catch {
    return { status: "unreachable" };
  }
}

// The browser's IP, as the host's reverse proxy reported it. Django's rate
// limits (DRF throttles) count requests per client IP. Once requests come
// from the Next server instead of the browser, every visitor would share
// ONE IP and one login limit (5 a minute for the whole site), unless the
// original IP is passed along in X-Forwarded-For.
export function forwardedFor(request: Request): Record<string, string> {
  const xff = request.headers.get("x-forwarded-for");
  return xff ? { "X-Forwarded-For": xff } : {};
}

// CSRF guard for routes that change state. Browsers label every request
// with Sec-Fetch-Site: "same-origin" means one of our own pages sent it,
// "none" means the user typed the URL or used a bookmark. "same-site" or
// "cross-site" means another site's page started it, which is what a
// CSRF attack looks like, so those get refused. No header at all means the
// sender isn't a browser (curl, server code). Those can't carry a
// victim's cookies, so they're let through.
export function isCrossSite(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  return site !== null && site !== "same-origin" && site !== "none";
}

export function crossSiteRefused() {
  return NextResponse.json(
    { detail: "Cross-site request refused." },
    { status: 403 },
  );
}

export function backendUnreachable() {
  return NextResponse.json(
    { detail: "Could not reach the server. Try again in a moment." },
    { status: 502 },
  );
}

// Turns Django's login response (password or Google) into OUR response.
// On success: the tokens go into httpOnly cookies and are removed from the
// JSON body, so the browser gets every other field but never a token. On
// failure: Django's status and error body pass through untouched, so the
// forms show the same messages as before (including the 429 from the
// login rate limit).
export async function sessionFromLoginResponse(djangoRes: Response) {
  const data = await djangoRes.json().catch(() => ({}));
  if (
    !djangoRes.ok ||
    typeof data.access !== "string" ||
    typeof data.refresh !== "string"
  ) {
    return NextResponse.json(data, {
      status: djangoRes.ok ? 502 : djangoRes.status,
    });
  }
  const { access, refresh, ...rest } = data;
  const response = NextResponse.json({ ok: true, ...rest });
  setAuthCookies(response, { access, refresh });
  return response;
}
