"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Maximize2, Minimize2, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListingCreateForm } from "@/app/(admin)/dashboard/[user]/listings/_components/listing-create-form";

// Docked right-side panel for EDITING a listing directly (reached via
// client-side nav to /dashboard/[user]/listings/[id]/edit — e.g. the
// "Edit Listing" link on the full-page preview fallback). Same docked-
// aside pattern as every other panel in this app; a hard load/refresh
// instead falls through to the real listings/[id]/edit/page.tsx full
// page.
//
// This is a separate route from
// @modal/(.)dashboard/[user]/listings/[id]/page.tsx (which handles
// preview->edit toggling INSIDE one already-open panel) because
// Next.js intercepting routes match on the URL actually being
// navigated to — a direct link to .../edit needs its own interceptor
// at that exact path.

export default function InterceptedListingEditPanel({
  params,
}: {
  params: Promise<{ user: string; id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
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
          <h2 className="text-lg font-semibold leading-none">Edit Listing</h2>
          <p className="text-muted-foreground mt-1.5 text-sm">
            {expanded
              ? "Expanded — contract to see the list again."
              : "Update details — the list refreshes once saved."}
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
          <ListingCreateForm listingId={id} />
        </div>
      </div>
    </aside>
  );
}
