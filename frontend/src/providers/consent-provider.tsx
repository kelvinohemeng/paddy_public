"use client";

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";

const CONSENT_STORAGE_KEY = "paddy_cookie_consent";
const CONSENT_CHANGE_EVENT = "paddy-consent-change";

type ConsentState = "pending" | "accepted" | "rejected";

type ConsentContextValue = {
  // null = not known yet (server render / first hydration pass). The
  // banner only shows for "pending", so it never flashes for visitors
  // who already chose.
  consent: ConsentState | null;
  acceptConsent: () => void;
  rejectConsent: () => void;
};

const ConsentContext = createContext<ConsentContextValue | null>(null);

// localStorage as an external store: the server snapshot is null and the
// client snapshot is the stored choice, so React reconciles the two
// without a hydration mismatch. (Previously the state defaulted to null
// on the client too, and the banner's `consent !== "pending"` check
// meant it never appeared for new visitors.)
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CONSENT_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CONSENT_CHANGE_EVENT, onChange);
  };
}

function getSnapshot(): ConsentState {
  const stored = window.localStorage.getItem(CONSENT_STORAGE_KEY);
  return stored === "accepted" || stored === "rejected" ? stored : "pending";
}

function getServerSnapshot(): ConsentState | null {
  return null;
}

function store(choice: "accepted" | "rejected") {
  window.localStorage.setItem(CONSENT_STORAGE_KEY, choice);
  window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
}

export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const consent = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const value = useMemo(
    () => ({
      consent,
      acceptConsent: () => store("accepted"),
      rejectConsent: () => store("rejected"),
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
