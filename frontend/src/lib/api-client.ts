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

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
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
