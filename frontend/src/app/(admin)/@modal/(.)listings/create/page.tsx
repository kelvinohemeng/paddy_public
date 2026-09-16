"use client";

import { useRouter } from "next/navigation";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListingCreateForm } from "@/app/(admin)/listings/_components/listing-create-form";

// Docked right-side panel (NOT a centered overlay Dialog).
//
// Previously this file wrapped <ListingCreateForm /> in a Dialog, which
// renders via a Portal as position:fixed — floating OVER the list page
// without affecting its layout at all.
//
// Now it renders a plain <aside> that is a flex sibling of {children}
// (see (admin)/layout.tsx). When this route is active the aside takes
// ~448px on the right and physically squeezes the listings list;
// when @modal/default.tsx (null) is active it adds nothing.
// Close = router.back(), which drops /listings/create from the URL and
// un-renders this intercepted route.

export default function InterceptedListingCreatePanel() {
  const router = useRouter();

  return (
    <aside className="bg-background flex max-h-screen w-full max-w-md shrink-0 flex-col border-l shadow-xl animate-in slide-in-from-right duration-300 sticky top-0">
      <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold leading-none">Create Listing</h2>
          <p className="text-muted-foreground mt-1.5 text-sm">
            Add details and photos — the list updates once saved.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => router.back()}
          aria-label="Close panel"
        >
          <XIcon className="size-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <ListingCreateForm />
      </div>
    </aside>
  );
}
