"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

const CONSENT_STORAGE_KEY = "paddy_cookie_consent";

type ConsentState = "pending" | "accepted" | "rejected";

type ConsentContextValue = {
  consent: ConsentState;
  acceptConsent: () => void;
  rejectConsent: () => void;
};

const ConsentContext = createContext<ConsentContextValue | null>(null);

export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const [consent, setConsent] = useState<string | null>(() => {
    // Check if window is defined (if you are using Next.js/SSR)
    if (typeof window !== "undefined") {
      const storedConsent = window.localStorage.getItem(CONSENT_STORAGE_KEY);
      if (storedConsent === "accepted" || storedConsent === "rejected") {
        return storedConsent;
      }
    }
    return null; // Default fallback state
  });

  const value = useMemo(
    () => ({
      consent,
      acceptConsent: () => {
        window.localStorage.setItem(CONSENT_STORAGE_KEY, "accepted");
        setConsent("accepted");
      },
      rejectConsent: () => {
        window.localStorage.setItem(CONSENT_STORAGE_KEY, "rejected");
        setConsent("rejected");
      },
    }),
    [consent],
  );

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

export function useConsent() {
  const context = useContext(ConsentContext);
  if (!context) throw new Error("useConsent must be used inside ConsentProvider");
  return context;
}
