"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Maximize2, Minimize2, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListingCreateForm } from "@/app/(admin)/dashboard/[user]/listings/_components/listing-create-form";

// Docked right-side panel (NOT a centered overlay Dialog).
//
// Renders a plain <aside> that is a flex sibling of {children}
// (see (admin)/layout.tsx). When this route is active the aside takes
// ~448px on the right and physically squeezes the listings list;
// when @modal/default.tsx (null) is active it adds nothing.
// Close = router.back(), which drops .../listings/create from the URL
// and un-renders this intercepted route.

export default function InterceptedListingCreatePanel() {
  const router = useRouter();
  // Local UI-only toggle — expanding swaps the aside's classes between
  // "docked" (flex sibling squeezing the list) and "expanded" (fixed
  // full-area takeover). The <ListingCreateForm /> instance itself never
  // unmounts, so half-filled values + picked File objects survive the
  // toggle with zero storage code.
  const [expanded, setExpanded] = useState(false);

  return (
    <aside
      className={
        expanded
          ? "bg-background fixed inset-0 z-40 flex w-full flex-col animate-in slide-in-from-right duration-300"
          : "bg-background flex max-h-screen w-full max-w-md shrink-0 flex-col border-l shadow-xl animate-in slide-in-from-right duration-300 sticky top-0"
      }
    >
      <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold leading-none">Create Listing</h2>
          <p className="text-muted-foreground mt-1.5 text-sm">
            {expanded
              ? "Expanded — contract to see the list again."
              : "Add details and photos — the list updates once saved."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Contract panel" : "Expand panel"}
            title={expanded ? "Contract panel" : "Expand to full page"}
          >
            {expanded ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </Button>
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
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className={expanded ? "mx-auto w-full max-w-2xl" : undefined}>
          <ListingCreateForm />
        </div>
      </div>
    </aside>
  );
}
