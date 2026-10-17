"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { PaddyButton } from "@/components/paddy-button";
import { PaddySpinnerIcon } from "@/components/paddy-icons";

// Shown in place of listings when the backend didn't answer a page's
// server-side fetch. On Render's free plan the backend sleeps after 15
// idle minutes and takes about a minute to wake, and while it wakes
// Render refused the Next server's requests (429, "hibernate-rate-
// limited") but let a direct request through. So the browser asks the
// backend directly, which wakes it, then re-runs the page's server fetch.
// Once listings arrive the page stops rendering this.
const GIVE_UP_AFTER_MS = 120_000;

// Render holds a direct request while the backend wakes, then answers.
// The root URL is a tiny 404 with no database work; any answer will do,
// and no-cors because we never read it.
function knock() {
  return fetch(`${process.env.NEXT_PUBLIC_API_URL}/`, {
    mode: "no-cors",
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  }).catch(() => {});
}

// In the root layout: every visit starts waking the backend straight
// away, so it's up (or nearly) by the time someone signs in or opens a
// page whose server fetch needs it.
export function WakeBackend() {
  useEffect(() => {
    knock();
  }, []);
  return null;
}

export function BackendWaking() {
  const router = useRouter();
  const [round, setRound] = useState(0);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const started = Date.now();
    (async () => {
      while (!cancelled && Date.now() - started < GIVE_UP_AFTER_MS) {
        await knock();
        if (cancelled) return;
        router.refresh();
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
      if (!cancelled) setGaveUp(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, round]);

  return (
    <div
      role="status"
      className="mx-auto flex max-w-sm flex-col items-center gap-3 p-6 text-center"
    >
      {gaveUp ? (
        <>
          <p className="text-sm font-medium">
            This is taking longer than usual.
          </p>
          <PaddyButton
            variant="secondary"
            onClick={() => {
              setGaveUp(false);
              setRound((r) => r + 1);
            }}
          >
            Try again
          </PaddyButton>
        </>
      ) : (
        <>
          <PaddySpinnerIcon className="size-6 animate-spin" aria-hidden />
          <p className="text-sm font-medium">Waking up the demo</p>
          <p className="text-muted-foreground text-sm">
            paddy&apos;s demo runs on free hosting that sleeps when nobody is
            visiting. It takes about a minute to start, and this page will
            fill in by itself.
          </p>
        </>
      )}
    </div>
  );
}
