"use client";

import Link from "next/link";
import { Menu } from "lucide-react";

import { Logo } from "@/components/logo";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Discovery Hub header row — Figma Default State top bar: Logo
// left, "List your property" CTA + hamburger right. The Rent/Buy
// tabs live in the search pill (dh-search-pill.tsx), not here.
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
