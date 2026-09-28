"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchMySubscription,
  type LandlordSubscription,
} from "@/lib/payments";

// The landlord's plan + usage numbers (GET /payments/subscription/),
// shared through TanStack Query so the subscription card and the listing
// form stepper read ONE cached copy instead of fetching separately.
//
// The key sits under ["api", "payments"] on purpose: useApiInvalidate's
// invalidate("payments") refreshes it, so anything that changes the
// numbers (creating, submitting or archiving a listing) can refresh the
// card the same way it refreshes the listings grid.
export const SUBSCRIPTION_QUERY_KEY = ["api", "payments", "subscription"];

export function useMySubscription(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: SUBSCRIPTION_QUERY_KEY,
    queryFn: fetchMySubscription,
    enabled: options.enabled ?? true,
    // Only landlords have a subscription (403 for everyone else) —
    // retrying a 403 just delays the "not applicable" state.
    retry: false,
  });
}

// For a response that already carries the fresh subscription (the cancel
// endpoint returns it), so the card updates without a second request.
export function useSetMySubscription() {
  const queryClient = useQueryClient();
  return (subscription: LandlordSubscription) =>
    queryClient.setQueryData(SUBSCRIPTION_QUERY_KEY, subscription);
}
