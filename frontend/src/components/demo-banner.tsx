"use client";

import { useEffect, useRef } from "react";

const TEST_CARDS_URL = "https://paystack.com/docs/payments/test-payments/";

// Permanent notice for the portfolio demo: no close button, no storage.
// Rendered once in app/layout.tsx and stuck to the top of every page, so
// fixed and sticky things sit below it via --demo-banner-h, and
// full-height layouts use --page-h instead of 100svh (both in
// globals.css).
export function DemoBanner() {
  const ref = useRef<HTMLElement>(null);

  // globals.css guesses the banner's height for first paint. The copy
  // wraps differently on narrow phones (or after a copy change), so keep
  // the variable equal to the real height.
  useEffect(() => {
    const banner = ref.current;
    if (!banner) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() =>
      root.style.setProperty("--demo-banner-h", `${banner.offsetHeight}px`),
    );
    observer.observe(banner);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--demo-banner-h");
    };
  }, []);

  return (
    <aside
      ref={ref}
      aria-label="Demo notice"
      className="bg-paddy-yellow-100 text-paddy-yellow-900 font-label sticky top-0 z-50 px-4 py-1.5 text-center text-xs font-medium"
    >
      Demo project. Homes, landlords and payments are not real. To try an
      unlock, pay with a{" "}
      <a
        href={TEST_CARDS_URL}
        target="_blank"
        rel="noreferrer"
        className="font-semibold underline underline-offset-2"
      >
        Paystack test card
      </a>
      .
    </aside>
  );
}
