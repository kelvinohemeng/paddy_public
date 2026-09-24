"use client";

// Favorite (save/unsave) state for the public Discovery Hub.
//
// Why this exists: /homes fetches listings on the SERVER with no auth
// (SSR + 60s revalidate, see homes/page.tsx), so every row's
// `is_saved` is false there — the server fetch can't know who's
// looking. This hook fills that gap in the browser: once the visitor
// is known to be a renter, it pulls their saved list once
// (GET /listings/saved/ — unpaginated, so one call covers every id)
// and every card reads its heart state from that one Set.
//
// Toggling is optimistic: the heart flips immediately, the request
// runs, and a failure rolls the cache back with a toast. Same backend
// contract as SaveToggle (POST/DELETE /listings/<id>/save/).
//
// Who sees what:
//   renter      → working heart
//   anonymous   → heart visible (Figma Default state); tapping prompts sign-in
//   landlord/staff → no heart (backend 403s saving for non-renters)

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useMe } from "@/hooks/use-auth";
import { useApiList, type ApiListResult } from "@/hooks/use-api";
import { authedFetch } from "@/lib/api";

type SavedRow = { id: number | string; listing: number | string };

const SAVED_RESOURCE = "listings/saved";
// Matches useApiList's key for an unfiltered list — see use-api.ts's
// query-key contract.
const SAVED_KEY = ["api", SAVED_RESOURCE, {}];

export type FavoriteMode = "hidden" | "anonymous" | "renter";

export function useSavedListings() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: me, isPending: meLoading } = useMe();

  const isRenter = me?.role === "renter";
  const mode: FavoriteMode = meLoading
    ? "hidden" // don't flash a heart for a landlord while identity resolves
    : !me
      ? "anonymous"
      : isRenter
        ? "renter"
        : "hidden";

  const saved = useApiList<SavedRow>(SAVED_RESOURCE, { enabled: isRenter });

  const savedIds = useMemo(
    () => new Set((saved.data?.data ?? []).map((row) => String(row.listing))),
    [saved.data],
  );

  const mutation = useMutation({
    mutationFn: async ({ id, save }: { id: number | string; save: boolean }) => {
      const res = await authedFetch(`/listings/${id}/save/`, {
        method: save ? "POST" : "DELETE",
      });
      if (!res.ok) {
        throw new Error(`Could not ${save ? "save" : "unsave"} this home`);
      }
    },
    onMutate: async ({ id, save }) => {
      await queryClient.cancelQueries({ queryKey: SAVED_KEY });
      const previous = queryClient.getQueryData<ApiListResult<SavedRow>>(SAVED_KEY);
      queryClient.setQueryData<ApiListResult<SavedRow>>(SAVED_KEY, (old) => {
        const rows = old?.data ?? [];
        const next = save
          ? [...rows, { id: `optimistic-${id}`, listing: id }]
          : rows.filter((row) => String(row.listing) !== String(id));
        return { data: next, total: next.length };
      });
      return { previous };
    },
    onError: (err, _vars, context) => {
      queryClient.setQueryData(SAVED_KEY, context?.previous);
      toast.error(err instanceof Error ? err.message : "Could not save this home");
    },
    onSettled: () => {
      // Also refreshes the dashboard's Saved Homes page and count.
      queryClient.invalidateQueries({ queryKey: ["api", SAVED_RESOURCE] });
    },
  });

  const isSaved = useCallback(
    (id: number | string) => savedIds.has(String(id)),
    [savedIds],
  );

  const toggle = useCallback(
    (id: number | string) => {
      if (mode === "anonymous") {
        toast("Sign in to save homes", {
          description: "Create a free renter account to keep a shortlist.",
          action: { label: "Sign in", onClick: () => router.push("/login") },
        });
        return;
      }
      if (mode !== "renter" || mutation.isPending) return;
      mutation.mutate({ id, save: !savedIds.has(String(id)) });
    },
    [mode, mutation, router, savedIds],
  );

  return { mode, isSaved, toggle };
}
