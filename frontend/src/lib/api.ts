"use client";

// Shared authenticated-fetch helper for browser code. Every signed-in
// call goes to OUR server's /api/backend/* route
// (app/api/backend/[...path]/route.ts), never straight to Django. The
// session tokens live in httpOnly cookies that this code can't read
// (that's the point: an injected script can't steal them either), so
// that route adds the Bearer header and refreshes expired tokens on the
// server. The browser attaches the cookies by itself, since the request
// is same-origin.
//
// payments.ts deliberately keeps its own paymentsFetch — AGENTS.md holds
// payment code to a higher review bar than the rest of the app, so it
// doesn't get absorbed into a generic helper casually. It shares
// backendUrl() below.
//
// Body handling is explicit rather than magic:
//   - pass `json`  → body becomes JSON.stringify(json) and
//     Content-Type: application/json is set
//   - pass `formData` → body is the FormData and NO Content-Type is set —
//     the browser must generate the multipart boundary itself; setting
//     Content-Type manually breaks multipart uploads (see the comment on
//     uploadPhotos in listing-form-stepper.tsx)
//   - pass neither → request with no body (GET, DELETE, no-payload POST)

type AuthedFetchOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  json?: unknown;
  formData?: FormData;
  headers?: Record<string, string>;
};

// Maps a Django path to the same-origin proxy route:
//   "/accounts/me/"         → "/api/backend/accounts/me"
//   "/listings/?mine=true"  → "/api/backend/listings?mine=true"
// The trailing slash comes off because Next would redirect it away
// anyway; the proxy route puts it back before calling Django.
export function backendUrl(path: string): string {
  const queryStart = path.indexOf("?");
  const pathname = queryStart === -1 ? path : path.slice(0, queryStart);
  const query = queryStart === -1 ? "" : path.slice(queryStart);
  return `/api/backend${pathname.replace(/\/+$/, "")}${query}`;
}

export async function authedFetch(
  path: string,
  options: AuthedFetchOptions = {},
): Promise<Response> {
  const { method = "GET", json, formData, headers } = options;

  // A 401 that comes back from here is final: the proxy route has already
  // tried a refresh. Callers decide what to show (never auto-logout).
  return fetch(backendUrl(path), {
    method,
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : formData,
  });
}

// TS strict-mode catch narrowing: thrown values are `unknown`, and every
// error this codebase throws client-side is a plain `new Error(message)`
// or a thrown DRF-shaped object — read `.message` through this guard
// rather than `any`-casting at every catch site. Shared by every catch
// block that used to inline `err instanceof Error && err.message`.
export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
