"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Maximize2, Minimize2, X } from "lucide-react";

import { cn } from "@/lib/utils";

// The right-hand drawer used by intercepted routes — Discovery's
// listing preview (Figma "Discovery Page - Listing Detail", 171:2570)
// and the dashboard's listing create / preview / edit panels, so both
// open, expand and close the same way:
//
// - an 845px white panel (top-left radius 20) sliding in from the
//   right over a dimmed, blurred page; full width on phones
// - round close + expand buttons top-left, then an optional title, and
//   optional action buttons at the right end of the same row
// - closing plays the slide-out, then router.back() — which drops the
//   intercepted URL and returns to the page underneath untouched
//
// Built on Radix Dialog directly (the shared <Sheet> hard-codes a
// top-right close) for focus trapping, Esc to close and scroll locking.
//
// Expanding, two ways:
// - expandHref: a hard link to the route's full page. Discovery uses
//   this — the full listing page is SEO'd and shareable.
// - otherwise: the drawer widens in place to fill the screen. The
//   dashboard forms use this, because navigating away would throw out
//   a half-filled form and any picked photos.

const CLOSE_ANIMATION_MS = 220;

export function SideDrawer({
  title,
  showTitle = false,
  subtitle,
  expandHref,
  dismissOnOutsideClick = true,
  actions,
  bodyClassName,
  children,
}: {
  /** Accessible dialog name; shown in the header when showTitle is set. */
  title: string;
  showTitle?: boolean;
  subtitle?: string;
  /** Expand by opening this full page instead of widening in place. */
  expandHref?: string;
  /** Forms pass false so a stray click on the dimmed page can't discard
   *  unsaved input. Esc and the close button still close. */
  dismissOnOutsideClick?: boolean;
  /** Buttons at the right end of the header row (e.g. the dashboard
   *  preview's Update / Archive / Submit for review). */
  actions?: React.ReactNode;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);

  function close() {
    setOpen(false);
    // Let the slide-out play before the route (and this component) goes.
    window.setTimeout(() => router.back(), CLOSE_ANIMATION_MS);
  }

  const buttonClass =
    "inline-flex size-[34px] shrink-0 items-center justify-center rounded-full transition active:scale-95";

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          onInteractOutside={(e) => {
            if (!dismissOnOutsideClick) e.preventDefault();
          }}
          className={cn(
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-hidden bg-white shadow-2xl ease-out data-[state=closed]:duration-200 data-[state=open]:duration-300",
            "transition-[max-width,border-radius] duration-300",
            expanded ? "max-w-full" : "max-w-[845px] sm:rounded-tl-[20px]",
          )}
        >
          <div className="flex shrink-0 items-center gap-3 px-5 pt-7 pb-4 md:px-8">
            <Dialog.Close
              aria-label="Close"
              className={cn(buttonClass, "bg-zinc-100 hover:bg-zinc-200")}
            >
              <X className="size-5" />
            </Dialog.Close>
            {expandHref ? (
              // Plain <a>, not <Link>: a hard navigation skips the
              // interception and loads the full page.
              <a
                href={expandHref}
                aria-label="Open full page"
                title="Open full page"
                className={cn(buttonClass, "hover:bg-zinc-100")}
              >
                <Maximize2 className="size-4" />
              </a>
            ) : (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-label={expanded ? "Shrink panel" : "Expand panel"}
                title={expanded ? "Shrink panel" : "Expand panel"}
                className={cn(buttonClass, "hover:bg-zinc-100")}
              >
                {expanded ? (
                  <Minimize2 className="size-4" />
                ) : (
                  <Maximize2 className="size-4" />
                )}
              </button>
            )}
            <div
              className={cn(
                "min-w-0 pl-1",
                !showTitle && "sr-only",
                // Phones: the action buttons need the room more.
                showTitle && actions && "max-sm:sr-only",
              )}
            >
              <Dialog.Title className="font-display truncate text-lg leading-tight font-medium tracking-[-0.02em]">
                {title}
              </Dialog.Title>
              {showTitle && subtitle && (
                <p className="font-label truncate text-xs font-medium text-black/60">
                  {subtitle}
                </p>
              )}
            </div>
            {actions && (
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {actions}
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div
              className={cn(
                bodyClassName,
                // In-place expand: keep form lines a readable length
                // instead of stretching across a wide screen.
                expanded && !expandHref && "mx-auto w-full max-w-3xl",
              )}
            >
              {children}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
