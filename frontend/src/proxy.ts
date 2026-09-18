import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Next 16 convention: `proxy.ts` (middleware.ts is deprecated) exporting
// `proxy`, at src/ level next to app/. Runs before routes render —
// including RSC requests from client-side navigation, not just reloads.
//
// WHAT THIS FIXES: SimpleJWT access tokens die after 5 min (no
// SIMPLE_JWT lifetimes configured backend-side, so defaults apply),
// while the access_token cookie lives 1 day. Previously, any (admin)
// load after expiry hit (admin)/layout.tsx's live /accounts/me/ check
// with a dead token → 401 → /login → (cookie still present) → /,
// an unbreakable-looking loop while "logged in". This proxy refreshes
// the access cookie from the refresh_token cookie BEFORE the layout
// check runs, so the session survives seamlessly.
//
// Deliberately self-contained (no imports from src/) — Next's docs warn
// against shared modules between proxy and app code, so the small
// decoder duplication with lib/auth-refresh.ts is intentional.

const ACCESS_COOKIE = "access_token";
const REFRESH_COOKIE = "refresh_token";

// Refresh while still-valid-but-close, so a token never dies in the
// seconds between this check and the layout's own /me/ fetch.
const EXPIRY_SKEW_SECONDS = 30;

function getTokenExpiry(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    let b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4;
    if (pad) b64 += "=".repeat(4 - pad);
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const json = JSON.parse(new TextDecoder().decode(bytes));
    return typeof json.exp === "number" ? json.exp : null;
  } catch {
    // Unparseable token — treat as expired so we attempt a refresh
    // rather than handing garbage to the layout check.
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const access = request.cookies.get(ACCESS_COOKIE)?.value;

  // No token at all — nothing to refresh. (admin)/layout.tsx owns the
  // logged-out redirect; this proxy only rescues expiring sessions.
  if (!access) return NextResponse.next();

  const exp = getTokenExpiry(access);
  const now = Math.floor(Date.now() / 1000);

  // Still valid with margin — pass through untouched.
  if (exp !== null && exp - now > EXPIRY_SKEW_SECONDS) {
    return NextResponse.next();
  }

  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  // No refresh token (e.g. a session from before refresh cookies
  // existed) — pass through; the layout bounces to /login, whose page
  // renders a real form since... actually the stale access cookie is
  // still present, so it bounces to "/". Re-login overwrites both
  // cookies and heals this. Acceptable one-time path, not a loop:
  // every subsequent login mints a refresh cookie.
  if (!refresh) return NextResponse.next();

  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/accounts/login/refresh/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh }),
      },
    );
    if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
    const data = await res.json();
    if (!data.access) throw new Error("no access token in refresh response");

    const response = NextResponse.next();
    response.cookies.set(ACCESS_COOKIE, data.access, {
      path: "/",
      maxAge: 60 * 60 * 24,
    });
    // Rotation is OFF backend-side by default (response holds only
    // `access`), but handle it anyway so enabling
    // ROTATE_REFRESH_TOKENS later doesn't silently kill sessions.
    if (data.refresh) {
      response.cookies.set(REFRESH_COOKIE, data.refresh, {
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
    }
    return response;
  } catch {
    // Refresh dead too (logged out elsewhere, refresh expired, backend
    // down-and-responding-4xx). Clear BOTH cookies and send to /login:
    // with no cookies the login page renders a REAL form instead of
    // bouncing to "/", which is what breaks the loop for good.
    // (If the backend is merely unreachable, fetch throws the same
    // way — user lands on login and retries; acceptable.)
    const response = NextResponse.redirect(new URL("/login", request.url));
    // Explicit expired-with-path="/" (not .delete(), whose default path
    // is version-dependent) — guaranteed to actually kill the cookies
    // that were set with path "/".
    response.cookies.set(ACCESS_COOKIE, "", { path: "/", maxAge: 0 });
    response.cookies.set(REFRESH_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  }
}

export const config = {
  // Scoped to the gated section only. Public pages never carry a
  // session requirement, so running refresh logic there would just add
  // latency — and if new gated sections appear later, add them here.
  matcher: ["/dashboard/:path*"],
};
