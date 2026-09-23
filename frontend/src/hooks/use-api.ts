"use client";

// Data hooks — plain TanStack Query over the api-client. This replaces
// Refine's useList/useOne/useCreate/useUpdate/useInvalidate with the
// same DRF conventions and no framework in between.
//
// Query-key contract (load-bearing for invalidation): every key starts
// with ["api", resource], so invalidating ["api", "listings"] refreshes
// both list queries (["api", "listings", {params}]) and detail queries
// (["api", "listings", id]) — the same "list + detail" refresh the old
// invalidate({ resource, invalidates: ["list", "detail"] }) calls did.

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api-client";

export type ApiFilter = { field: string; value: string };

function toParams(filters?: ApiFilter[]): Record<string, string> | undefined {
  if (!filters || filters.length === 0) return undefined;
  return Object.fromEntries(filters.map((f) => [f.field, f.value]));
}

export type ApiListResult<T> = {
  data: T[];
  total: number;
};

async function fetchList<T>(
  resource: string,
  filters?: ApiFilter[],
): Promise<ApiListResult<T>> {
  const data = await apiGet<unknown>(`/${resource}/`, toParams(filters));
  // DRF pagination wraps in {results, count}; plain endpoints return a
  // bare array. Both shapes occur in this backend — handle both.
  if (Array.isArray(data)) return { data: data as T[], total: data.length };
  const record = data as { results?: T[]; count?: number };
  return { data: record.results ?? [], total: record.count ?? 0 };
}

export function useApiList<T = any>(
  resource: string,
  options: {
    filters?: ApiFilter[];
    enabled?: boolean;
    queryOptions?: Omit<
      UseQueryOptions<ApiListResult<T>>,
      "queryKey" | "queryFn"
    >;
  } = {},
) {
  const { filters, enabled, queryOptions } = options;
  return useQuery({
    queryKey: ["api", resource, toParams(filters) ?? {}],
    queryFn: () => fetchList<T>(resource, filters),
    enabled,
    ...queryOptions,
  });
}

export function useApiOne<T = any>(
  resource: string,
  id: string | number | undefined,
  options: {
    enabled?: boolean;
  } = {},
) {
  return useQuery({
    queryKey: ["api", resource, id],
    queryFn: () => apiGet<T>(`/${resource}/${id}/`),
    enabled: id !== undefined && (options.enabled ?? true),
  });
}

export function useApiCreate<T = any>(
  resource: string,
  options: {
    mutationOptions?: Omit<
      UseMutationOptions<T, Error, Record<string, unknown>>,
      "mutationFn"
    >;
  } = {},
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      apiPost<T>(`/${resource}/`, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api", resource] });
    },
    ...options.mutationOptions,
  });
}

export function useApiUpdate<T = any>(
  resource: string,
  options: {
    mutationOptions?: Omit<
      UseMutationOptions<T, Error, { id: string | number } & Record<string, unknown>>,
      "mutationFn"
    >;
  } = {},
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...values }: { id: string | number } & Record<string, unknown>) =>
      apiPut<T>(`/${resource}/${id}/`, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api", resource] });
    },
    ...options.mutationOptions,
  });
}

export function useApiDelete(resource: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string | number) => apiDelete(`/${resource}/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api", resource] });
    },
  });
}

// Drop-in for the old useInvalidate({ resource }) calls: refreshes every
// cached query under that resource (lists and details alike).
export function useApiInvalidate() {
  const queryClient = useQueryClient();
  return (resource: string | string[]) => {
    const resources = Array.isArray(resource) ? resource : [resource];
    return Promise.all(
      resources.map((r) =>
        queryClient.invalidateQueries({ queryKey: ["api", r] }),
      ),
    );
  };
}
