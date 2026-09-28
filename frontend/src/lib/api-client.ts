"use client";

// Generic JSON API client over authedFetch (Bearer token + one silent
// refresh + replay live in @/lib/api). This replaces the Refine
// dataProvider's customFetch — same DRF conventions, no framework:
//   - GET /{resource}/?{field=value...} for lists (filters append verbatim,
//     exactly what ListingViewSet.get_queryset reads via query_params)
//   - GET /{resource}/{id}/, POST /{resource}/, PUT /{resource}/{id}/
//   - trailing slashes everywhere (DRF routers 301 otherwise, and
//     fetch can downgrade a redirected POST to a bodyless GET)
// Non-2xx throws ApiError with the backend's actual reason, unwrapping
// DRF's three error shapes ({detail}, {detail: [...]}, {field: [...]}).

import { authedFetch } from "@/lib/api";

export class ApiError extends Error {
  statusCode: number;
  // The backend's machine-readable reason, when it sends one — e.g.
  // "email_not_verified" (accounts/permissions.py) or
  // "listing_total_limit_reached" (ListingViewSet.perform_create). Callers
  // branch on THIS, never on the wording of the message, which the
  // backend may reword.
  code?: string;
  // The parsed error body, for the few callers that need an extra field
  // (e.g. listings_used / listing_cap next to listing_limit_reached).
  data?: unknown;

  constructor(message: string, statusCode: number, code?: string, data?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.data = data;
  }
}

// Reads the `code` key off a DRF error body, if there is one.
export function errorCode(body: unknown): string | undefined {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const code = (body as Record<string, unknown>).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

function extractErrorMessage(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) {
    return data.length > 0 ? extractErrorMessage(data[0]) : null;
  }
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    return (
      extractErrorMessage(record.detail) ??
      extractErrorMessage(record.message) ??
      extractErrorMessage(record.error) ??
      (Object.keys(record).length > 0
        ? extractErrorMessage(record[Object.keys(record)[0]])
        : null)
    );
  }
  return null;
}

async function request<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    json?: unknown;
    params?: Record<string, string>;
  } = {},
): Promise<T> {
  const { method = "GET", json, params } = options;
  const query = params ? `?${new URLSearchParams(params).toString()}` : "";
  const res = await authedFetch(`${path}${query}`, { method, json });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      extractErrorMessage(body) ?? `Request failed (HTTP ${res.status})`,
      res.status,
      errorCode(body),
      body,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function apiGet<T>(path: string, params?: Record<string, string>) {
  return request<T>(path, { params });
}

export function apiPost<T>(path: string, json?: unknown) {
  return request<T>(path, { method: "POST", json });
}

export function apiPut<T>(path: string, json?: unknown) {
  return request<T>(path, { method: "PUT", json });
}

export function apiPatch<T>(path: string, json?: unknown) {
  return request<T>(path, { method: "PATCH", json });
}

export function apiDelete(path: string) {
  return request<void>(path, { method: "DELETE" });
}
