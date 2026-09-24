"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Maximize2, X } from "lucide-react";

// Figma "Discovery Page - Listing Detail" (171:2570): an 845px white
// panel (top-left radius 20) sliding in from the right over the hub,
// close + expand buttons top-left. Built on Radix Dialog directly (the
// shared <Sheet> hard-codes a top-right close) for focus trapping, Esc
// to close and scroll locking. Closing = router.back(), which returns
// to /homes with the map and scroll position untouched.
export function ListingDetailDrawer({
  listingId,
  children,
}: {
  listingId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);

  function close() {
    setOpen(false);
    // Let the slide-out play before the route (and this component) goes.
    window.setTimeout(() => router.back(), 220);
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right fixed inset-y-0 right-0 z-50 flex w-full max-w-[845px] flex-col overflow-hidden bg-white shadow-2xl ease-out data-[state=closed]:duration-200 data-[state=open]:duration-300 sm:rounded-tl-[20px]"
        >
          <Dialog.Title className="sr-only">Listing preview</Dialog.Title>
          <div className="flex shrink-0 items-center gap-3 px-5 pt-7 pb-4 md:px-8">
            <Dialog.Close
              aria-label="Close preview"
              className="inline-flex size-[34px] items-center justify-center rounded-full bg-zinc-100 transition hover:bg-zinc-200 active:scale-95"
            >
              <X className="size-5" />
            </Dialog.Close>
            {/* Plain <a>, not <Link>: a hard navigation skips the
                interception and loads the full page. */}
            <a
              href={`/homes/${listingId}`}
              aria-label="Open full page"
              title="Open full page"
              className="inline-flex size-[34px] items-center justify-center rounded-full transition hover:bg-zinc-100 active:scale-95"
            >
              <Maximize2 className="size-4" />
            </a>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
