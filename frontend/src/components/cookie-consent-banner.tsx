"use client";

import { useConsent } from "@/providers/consent-provider";

export function CookieConsentBanner() {
  const { consent, acceptConsent, rejectConsent } = useConsent();

  if (consent !== "pending") return null;

  return (
    <aside className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-2xl rounded-xl border bg-background p-4 shadow-lg">
      <p className="text-sm text-foreground">
        We use cookies and similar browser features to remember your preferences and, with your
        permission, help show homes near you. You can continue browsing without accepting.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="rounded-md border px-3 py-2 text-sm"
          onClick={rejectConsent}
        >
          Continue without
        </button>
        <button
          type="button"
          className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
          onClick={acceptConsent}
        >
          Accept
        </button>
      </div>
    </aside>
  );
}
