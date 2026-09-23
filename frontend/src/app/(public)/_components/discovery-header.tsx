"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Menu } from "lucide-react";

import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";
import { DISCOVERY_PATH } from "./discovery-path";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Rent/Buy segmented control — Figma "Frame 8" in the Discovery Hub
// Default State header (and the mobile bottom sheet). CLIENT-SIDE
// filter: writes a `listing_type` URL param that page.tsx deliberately
// does NOT forward to the backend (no listing_type query param exists
// on ListingViewSet) — DiscoverySplitView filters the already-fetched
// rows in the browser instead. Defaults to "rent": rentals are the
// core market and Figma shows Rent as the active segment.
export type ListingTypeFilter = "rent" | "buy";

export function RentBuyToggle({
  className,
  basePath = DISCOVERY_PATH,
}: {
  className?: string;
  basePath?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const raw = searchParams.get("listing_type");
  const value: ListingTypeFilter = raw === "buy" ? "buy" : "rent";

  function select(next: ListingTypeFilter) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("listing_type", next);
    router.push(`${basePath}?${params.toString()}`);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Listing type"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-xl rounded-b-none border p-1.5 border-b-0",
        className,
      )}
    >
      {(["rent", "buy"] as const).map((option) => {
        const selected = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => select(option)}
            className={cn(
              "flex-1 rounded-lg px-4 py-2 text-sm font-medium whitespace-nowrap transition md:flex-none",
              selected
                ? "bg-muted text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option === "rent" ? "Rent a property" : "Buy a property"}
          </button>
        );
      })}
    </div>
  );
}

// Discovery Hub header row — Figma Default State top bar: Logo
// left, "List your property" CTA + hamburger right. The Rent/Buy
// toggle is NOT here: Figma centers it above the search pill (full
// width on mobile), so page.tsx renders it as its own row.
export function DiscoveryHeader() {
  return (
    <div className="flex items-center justify-between gap-3">
      <Link href="/" aria-label="paddy home">
        <Logo />
      </Link>

      <div className="flex items-center gap-2">
        <Link
          href="/onboarding"
          className="hidden text-sm font-medium whitespace-nowrap hover:underline sm:inline"
        >
          List your property
        </Link>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Open menu"
              className="hover:bg-muted inline-flex size-8 items-center justify-center rounded-full border"
            >
              <Menu className="size-5" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-52" align="end">
            <nav className="flex flex-col text-sm">
              <Link href="/onboarding" className="hover:bg-muted rounded-md px-2 py-2">
                List your property
              </Link>
              <Link
                href="/dashboard"
                className="hover:bg-muted rounded-md px-2 py-2"
              >
                Saved homes
              </Link>
              <Link href="/login" className="hover:bg-muted rounded-md px-2 py-2">
                Sign in
              </Link>
            </nav>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
