"use client";

import { DataProvider } from "@refinedev/core";
import dataProviderSimpleRest from "@refinedev/simple-rest";
import { refreshAccessToken } from "@/lib/auth-refresh";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;


const customFetch = async (url: string, options: RequestInit = {}, retried = false) => {
    const token = localStorage.getItem("access_token")
    // Reading from the SAME storage key auth-provider.client.ts writes
    // to on login/register — this file doesn't own that token, it just
    // reads whatever's already there

    const headers = {
        "Content-Type": "application/json",
        ...options.headers,
        Authorization: token ? `Bearer ${token}` : "",
    }

    const response = await fetch(url, { ...options, headers })

    if (response.status === 401 && !retried) {
        // Access token likely expired mid-session (5-min SimpleJWT
        // default) — try ONE silent refresh and replay the original
        // request before surfacing the 401. Without this, any in-app
        // fetch after a few idle minutes fails even though the session
        // itself is still refreshable (src/proxy.ts only covers
        // navigation, not fetches fired from an already-loaded page).
        const fresh = await refreshAccessToken();
        if (fresh) {
            return customFetch(
                url,
                {
                    ...options,
                    headers: { ...options.headers, Authorization: `Bearer ${fresh}` },
                },
                true,
            );
        }
    }

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))

        throw {
            message: errorData.message || "Something went wrong",
            statusCode: response.status,
            error: errorData.error || "Unknown error",
        }
    }

    return response
}

export const dataProvider: DataProvider = {
    getList: async ({ resource, pagination, filters }) => {
        const params = new URLSearchParams();

        filters?.forEach((filter) => {
            if ("field" in filter) {
                params.append(filter.field, String(filter.value))
                // Mirrors exactly what your ListingViewSet.get_queryset()
                // already reads via request.query_params.get(...) — e.g. a
                // filter {field: "city", value: "Accra"} becomes ?city=Accra
            }
        })

        const response = await customFetch(`${API_URL}/${resource}/?${params}`)
        const data = await response.json()

        return {
            data: data.results ?? data,
            // DRF's pagination wraps results in {results: [...], count: N}
            // by default — this handles both that shape AND a plain array,
            // in case pagination isn't enabled on a given endpoint
            total: data.count ?? data.length,
            // Fixed: was data.lendgth (typo — not a real property,
            // always evaluated to undefined, silently breaking
            // pagination totals without ever throwing an error)
        }

    },

    getOne: async ({ resource, id }) => {
        const response = await customFetch(`${API_URL}/${resource}/${id}/`)
        const data = await response.json()

        return {
            data,
        }
    },

    getMany: async ({ resource, ids }) => {
        const params = new URLSearchParams()
        ids.forEach((id) => params.append("id", id.toString()))

        const response = await customFetch(`${API_URL}/${resource}/?${params.toString()}`)
        const data = await response.json()

        return {
            data: data.results ?? data,
        }
    },

    create: async ({ resource, variables }) => {
        const response = await customFetch(`${API_URL}/${resource}/`, {
            // Fixed: was missing the trailing slash — DRF's default
            // routers enforce a trailing slash on every endpoint, so
            // POST /listings (no slash) triggered a 301 redirect
            // instead of actually creating anything. Browsers/fetch
            // often silently convert a POST into a GET (and drop the
            // request body) when following a redirect, which is
            // exactly why the listing never actually got created even
            // though the UI appeared to "succeed" and navigate away.
            method: "POST",
            body: JSON.stringify(variables),
        })
        const data = await response.json()

        return { data }
    },

    update: async ({ resource, id, variables }) => {
        const response = await customFetch(`${API_URL}/${resource}/${id}/`, {
            method: "PUT",
            body: JSON.stringify(variables),
        })
        const data = await response.json()

        return { data }
    },

    // PATCH is often used for partial updates (like React Admin's default)
    updateMany: async ({ resource, ids, variables }) => {
        // You can either batch updates (DRF supports this in some setups)
        // or loop. Simple loop for now — adjust if you need bulk endpoints
        const responses = await Promise.all(
            ids.map((id) =>
                customFetch(`${API_URL}/${resource}/${id}/`, {
                    method: "PATCH",
                    body: JSON.stringify(variables),
                })
            )
        )
        const data = await Promise.all(responses.map((r) => r.json()))

        return { data }
    },

    // DELETE expects status 204 No Content on success
    deleteOne: async ({ resource, id }) => {
        await customFetch(`${API_URL}/${resource}/${id}/`, {
            method: "DELETE",
        })

        return { data: {} as any }
    },

    getApiUrl: () => API_URL!,
    // Refine requires this one regardless — some internal features
    // (like file upload URL construction) ask the data provider "what's
    // your base URL" directly, rather than going through a specific
    // CRUD method

    // deleteMany: async ({ resource, ids }) => {
    //     await Promise.all(
    //         ids.map((id) =>
    //             customFetch(`${API_URL}/${resource}/${id}/`, {
    //                 method: "DELETE",
    //             })
    //         )
    //     )

    //     return { success: true }
    // },
}