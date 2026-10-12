import { NextResponse, type NextRequest } from "next/server";

import {
  ACCESS_COOKIE,
  API_URL,
  backendUnreachable,
  clearAuthCookies,
  crossSiteRefused,
  forwardedFor,
  isCrossSite,
  isExpiredOrClose,
  REFRESH_COOKIE,
  refreshTokens,
  setAuthCookies,
  type RefreshResult,
} from "@/lib/auth-cookies";

// /api/backend/<path>  →  Django /<path>/
//
// Every signed-in request that browser code makes goes through here
// (authedFetch in lib/api.ts, paymentsFetch in lib/payments.ts). The
// browser can't read the httpOnly session cookies, so it can't add the
// Bearer header Django expects. This route does: it reads the access
// token from the cookie, refreshes it first if it's expired, forwards the
// request to Django with `Authorization: Bearer <token>`, and streams
// Django's response back unchanged.
//
// Trailing slash: Next redirects /foo/ to /foo before any route runs, so
// callers leave the slash off (backendUrl() in lib/api.ts does that) and
// it's added back here. Every Django URL in this project ends in "/".

type RouteContext = { params: Promise<{ path: string[] }> };

// Headers NOT copied from Django's response to ours:
// - connection / keep-alive / transfer-encoding: they describe the
//   Next↔Django connection, not the browser's.
// - content-encoding / content-length: fetch() already un-gzipped the
//   body, so the originals would be wrong.
// - set-cookie: Django sets none on these endpoints, and any it did set
//   would belong to Django's domain, not ours.
const SKIPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
  "content-length",
  "set-cookie",
]);

async function handle(request: NextRequest, { params }: RouteContext) {
  const method = request.method;
  const changesState = method !== "GET" && method !== "HEAD";

  // CSRF: the session cookies ride along on every request to this origin,
  // so a request another site starts must not be able to act as the user.
  // SameSite=Lax already keeps the cookies off cross-site POSTs; this
  // check is the second lock on the door.
  if (changesState && isCrossSite(request)) return crossSiteRefused();

  const { path } = await params;
  // Refuse "." / ".." segments, so the path can't climb out of the API.
  if (path.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return NextResponse.json({ detail: "Not found." }, { status: 404 });
  }
  const target = `${API_URL}/${path.map(encodeURIComponent).join("/")}/${request.nextUrl.search}`;

  // Read the body once, up front. Buffering (rather than streaming it
  // through) does two things: fetch() sends a proper Content-Length,
  // which Django needs to read a body at all, and the request can be
  // re-sent after a refresh (below). Photo uploads are the largest bodies
  // (10 MB per photo, checked by Django), which is fine to hold briefly.
  const body = changesState ? await request.arrayBuffer() : undefined;

  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  let access = request.cookies.get(ACCESS_COOKIE)?.value;
  let refreshed: RefreshResult | null = null;

  // Access tokens last 5 minutes. If ours has expired (or is about to)
  // and there's a refresh token, swap it for a fresh one BEFORE calling
  // Django, the same thing src/proxy.ts does on page navigations.
  if (refresh && (!access || isExpiredOrClose(access))) {
    refreshed = await refreshTokens(refresh);
    if (refreshed.status === "ok") access = refreshed.access;
    // Refresh token rejected: the session is over. Send the request
    // anonymously; public endpoints still answer, private ones 401.
    if (refreshed.status === "invalid") access = undefined;
    // "unreachable": keep the old token. Django is probably down, so the
    // request will fail and show the real error, and nobody gets signed
    // out over a network blip.
  }

  const send = (token: string | undefined) =>
    fetch(target, {
      method,
      headers: {
        ...forwardedFor(request),
        ...copyHeader(request, "content-type", "Content-Type"),
        ...copyHeader(request, "accept", "Accept"),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
      cache: "no-store",
    });

  let upstream: Response;
  try {
    upstream = await send(access);
    // Django can still reject a token that looked valid here, if the two
    // servers' clocks disagree. Refresh once and retry, like the old
    // client code did on any 401.
    if (upstream.status === 401 && refresh && refreshed === null) {
      refreshed = await refreshTokens(refresh);
      if (refreshed.status === "ok") {
        // Discard the 401's unread body, or its connection stays open.
        await upstream.body?.cancel();
        upstream = await send(refreshed.access);
      }
    }
  } catch {
    return backendUnreachable();
  }

  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!SKIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });
  // 204/304 responses (and HEAD requests) must not carry a body.
  const hasNoBody =
    method === "HEAD" || upstream.status === 204 || upstream.status === 304;
  const response = new NextResponse(hasNoBody ? null : upstream.body, {
    status: upstream.status,
    headers,
  });

  // Hand the browser the refreshed token, or end a dead session for good
  // so the next request doesn't try (and fail) to refresh it again.
  if (refreshed?.status === "ok") setAuthCookies(response, refreshed);
  if (refreshed?.status === "invalid") clearAuthCookies(response);

  return response;
}

function copyHeader(
  request: NextRequest,
  from: string,
  to: string,
): Record<string, string> {
  const value = request.headers.get(from);
  return value ? { [to]: value } : {};
}

export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
};
