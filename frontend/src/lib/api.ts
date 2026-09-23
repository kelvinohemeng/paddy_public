"use client";

// Shared authenticated-fetch helper — ONE home for the
// Bearer-from-localStorage + one-silent-refresh + replay dance that was
// previously copied inline in three places (dataProvider/index.ts's
// customFetch, listing-create-form.tsx's uploadPhotos, and the first
// lifecycle CTA). The dataProvider keeps its own copy for now (refactoring
// the core data path mid-stream wasn't worth the risk this pass);
// payments.ts ALSO deliberately keeps its own paymentsFetch — AGENTS.md
// holds payment code to a higher review bar than the rest of the app, so
// it doesn't get absorbed into a generic helper casually.
//
// Body handling is explicit rather than magic:
//   - pass `json`  → body becomes JSON.stringify(json) and
//     Content-Type: application/json is set
//   - pass `formData` → body is the FormData and NO Content-Type is set —
//     the browser must generate the multipart boundary itself; setting
//     Content-Type manually breaks multipart uploads (see the comment on
//     the photo upload in listing-create-form.tsx)
//   - pass neither → request with no body (GET, DELETE, no-payload POST)
//
// On a 401 (SimpleJWT's 5-minute default access lifetime), refreshes ONCE
// via the shared refreshAccessToken helper and replays — refreshAccessToken
// writes the new token back to localStorage before returning, so the
// replaying call re-reads the fresh token naturally.

import { refreshAccessToken } from "@/lib/auth-refresh";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

type AuthedFetchOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  json?: unknown;
  formData?: FormData;
  headers?: Record<string, string>;
};

export async function authedFetch(
  path: string,
  options: AuthedFetchOptions = {},
  retried = false,
): Promise<Response> {
  const { method = "GET", json, formData, headers } = options;
  const token = localStorage.getItem("access_token");

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
      Authorization: token ? `Bearer ${token}` : "",
    },
    body: json !== undefined ? JSON.stringify(json) : formData,
  });

  if (res.status === 401 && !retried) {
    const fresh = await refreshAccessToken();
    if (fresh) {
      return authedFetch(path, options, true);
    }
    // Refresh failed — return the original 401 and let the caller decide
    // (surface the error, never auto-logout on a network blip; same call
    // as auth-refresh.ts makes for its own failure mode).
  }

  return res;
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
