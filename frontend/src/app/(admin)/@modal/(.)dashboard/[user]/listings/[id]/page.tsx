"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Maximize2, Minimize2, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListingPreview } from "@/app/(admin)/dashboard/[user]/listings/_components/listing-preview";
import { ListingCreateForm } from "@/app/(admin)/dashboard/[user]/listings/_components/listing-create-form";

// Docked right-side panel for the listing PREVIEW — same "aside as a
// flex sibling, not a floating Dialog" pattern as
// @modal/(.)dashboard/[user]/listings/create/page.tsx. Intercepts
// client-side navigation to /dashboard/[user]/listings/[id]; a hard
// load/refresh instead falls through to the real
// listings/[id]/page.tsx full page (see that file's own comment).
//
// This panel does double duty as BOTH the preview AND, once "Edit
// Listing" is clicked, the edit form — toggled locally rather than
// navigating to a second intercepted route, so the panel doesn't
// flicker closed/reopen for what's conceptually the same "looking at
// this one listing" session.

export default function InterceptedListingShowPanel({
  params,
}: {
  params: Promise<{ user: string; id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<"preview" | "edit">("preview");

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
          <h2 className="text-lg font-semibold leading-none">
            {mode === "edit" ? "Edit Listing" : "Listing Preview"}
          </h2>
          <p className="text-muted-foreground mt-1.5 text-sm">
            {expanded
              ? "Expanded — contract to see the list again."
              : mode === "edit"
                ? "Update details — the list refreshes once saved."
                : "Quick look — expand or edit for the full picture."}
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
          {mode === "edit" ? (
            <ListingCreateForm listingId={id} />
          ) : (
            <ListingPreview
              listingId={id}
              onEdit={() => setMode("edit")}
            />
          )}
        </div>
      </div>
    </aside>
  );
}
