"use client";

import { createContext, useContext, useState } from "react";
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
//   right over a dimmed, blurred page
// - FULL-SCREEN below the md breakpoint (768px, the same breakpoint the
//   dashboard sidebar uses): no rounded corner and no expand button,
//   since there's nothing left to expand into
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
//
// Header actions, two ways:
// - the `actions` prop, for wrappers that own their buttons (the listing
//   preview's Update / Archive / Submit);
// - a portal slot, for a child that owns them. The listing form stepper
//   keeps its step and form state to itself, yet its Back / Next belong
//   in this header row (Figma 288:8254 puts Create Listing / Cancel
//   there). useSideDrawerActionsSlot() hands the child the header's
//   actions element to createPortal() into; outside a drawer it's null
//   and the child renders its buttons in place instead.

const CLOSE_ANIMATION_MS = 220;

const ActionsSlotContext = createContext<HTMLElement | null>(null);

/** The drawer header's actions element, or null outside a SideDrawer
 *  (and for the first render inside one, before the element exists). */
export function useSideDrawerActionsSlot(): HTMLElement | null {
  return useContext(ActionsSlotContext);
}

export function SideDrawer({
  title,
  showTitle = false,
  subtitle,
  subtitleClassName,
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
  /** Extra classes for the subtitle line — e.g. the listing preview turns
   *  it red when the listing was rejected. Keeps this drawer generic: it
   *  never needs to know what it's showing. */
  subtitleClassName?: string;
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
  // A callback ref into state (not useRef): children need a re-render
  // once the element exists so their portal can mount into it.
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);

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
          onEscapeKeyDown={(e) => {
            // Esc on an OPEN suggestion list (the listing form's address
            // autocomplete) should close that list, not the whole drawer
            // and every value typed into it. Radix hears Esc at the
            // document level before the input does, so check here.
            // (Radix popovers/selects inside the drawer already take
            // their own Esc first.)
            const focused = document.activeElement;
            if (
              focused?.getAttribute("role") === "combobox" &&
              focused.getAttribute("aria-expanded") === "true"
            ) {
              e.preventDefault();
            }
          }}
          className={cn(
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-hidden bg-white shadow-2xl ease-out data-[state=closed]:duration-200 data-[state=open]:duration-300",
            "transition-[max-width,border-radius] duration-300",
            // Below md: always the whole screen. From md up: the 845px
            // drawer with its rounded corner, or full width once expanded.
            "max-w-full",
            !expanded && "md:max-w-[845px] md:rounded-tl-[20px]",
          )}
        >
          <div className="flex shrink-0 items-center gap-3 px-5 pt-4 pb-3 md:px-8 md:pt-7 md:pb-4">
            <Dialog.Close
              aria-label="Close"
              className={cn(buttonClass, "bg-zinc-100 hover:bg-zinc-200")}
            >
              <X className="size-5" />
            </Dialog.Close>
            {expandHref ? (
              // Plain <a>, not <Link>: a hard navigation skips the
              // interception and loads the full page. Still offered on
              // phones — the full page is a different view, not a wider
              // one.
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
                // Hidden below md: the drawer is already full-screen.
                className={cn(buttonClass, "hover:bg-zinc-100 max-md:hidden")}
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
                <p className={cn("font-label text-xs font-medium text-black/60", subtitleClassName)}>
                  {subtitle}
                </p>
              )}
            </div>
            {/* Always rendered so a child can portal into it; empty:
                keeps an unused slot from taking space. */}
            <div
              ref={setActionsSlot}
              className="ml-auto flex shrink-0 items-center gap-2 empty:hidden"
            >
              {actions}
            </div>
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
              <ActionsSlotContext.Provider value={actionsSlot}>
                {children}
              </ActionsSlotContext.Provider>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
