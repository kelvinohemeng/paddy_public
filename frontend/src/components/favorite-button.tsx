"use client";

import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";

// Figma "Favorite" (Listing Card 175:21077): a bare heart glyph on the
// photo's top-right — outline by default, solid black when State=Saved.
// No circular chip behind it (that was SaveToggle's look); a soft drop
// shadow keeps the outline legible over dark photos.
//
// Presentational only — state and the save request live in
// useSavedListings, so one saved-list fetch drives every card.
export function FavoriteButton({
  saved,
  onToggle,
  className,
}: {
  saved: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        // Usually inside a card <Link> — never navigate on tap.
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      aria-pressed={saved}
      aria-label={saved ? "Remove from saved homes" : "Save this home"}
      title={saved ? "Remove from saved homes" : "Save this home"}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-full text-black transition hover:scale-110 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black",
        className,
      )}
    >
      <Heart
        className={cn(
          "size-6 drop-shadow-[0_1px_1.5px_rgba(255,255,255,0.9)]",
          saved && "fill-current",
        )}
        strokeWidth={1.75}
      />
    </button>
  );
}
