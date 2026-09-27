"use client";

import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";

// Figma "Favorite" component set (176:22213, used by the Listing Card
// at its photo's top-right, 6px in): a 23x21 #f2f2f2 chip with 3.66px
// corners holding a 15x13 heart — outline when Property 1=False, solid
// black when True. The two heart paths below are exported from Figma.
//
// appearance="bare" keeps the older large, chip-less heart that the
// listing detail header still uses until that page gets its design pass.
//
// Presentational only — state and the save request live in
// useSavedListings, so one saved-list fetch drives every card.

const HEART_OUTLINE =
  "M14.6081 4C13.2559 4 12.072 4.58148 11.334 5.56437C10.596 4.58148 9.41211 4 8.0599 4C6.98352 4.00121 5.95157 4.42934 5.19046 5.19046C4.42934 5.95157 4.00121 6.98352 4 8.0599C4 12.6437 10.7964 16.3539 11.0858 16.5071C11.1621 16.5482 11.2474 16.5696 11.334 16.5696C11.4206 16.5696 11.5059 16.5482 11.5822 16.5071C11.8716 16.3539 18.668 12.6437 18.668 8.0599C18.6668 6.98352 18.2387 5.95157 17.4776 5.19046C16.7165 4.42934 15.6845 4.00121 14.6081 4ZM11.334 15.4463C10.1383 14.7496 5.04772 11.5756 5.04772 8.0599C5.04876 7.26134 5.36644 6.49578 5.93111 5.93111C6.49578 5.36644 7.26134 5.04876 8.0599 5.04772C9.33353 5.04772 10.4029 5.72611 10.8494 6.81574C10.8889 6.91182 10.9561 6.994 11.0423 7.05183C11.1286 7.10967 11.2301 7.14055 11.334 7.14055C11.4379 7.14055 11.5394 7.10967 11.6257 7.05183C11.712 6.994 11.7791 6.91182 11.8186 6.81574C12.2652 5.72415 13.3345 5.04772 14.6081 5.04772C15.4067 5.04876 16.1722 5.36644 16.7369 5.93111C17.3016 6.49578 17.6193 7.26134 17.6203 8.0599C17.6203 11.5704 12.5284 14.7489 11.334 15.4463Z";
const HEART_SOLID =
  "M14.6081 4C13.2559 4 12.072 4.58148 11.334 5.56437C10.596 4.58148 9.41211 4 8.0599 4C6.98352 4.00121 5.95157 4.42934 5.19046 5.19046C4.42934 5.95157 4.00121 6.98352 4 8.0599C4 12.6437 10.7964 16.3539 11.0858 16.5071C11.1621 16.5482 11.2474 16.5696 11.334 16.5696C11.4206 16.5696 11.5059 16.5482 11.5822 16.5071C11.8716 16.3539 18.668 12.6437 18.668 8.0599C18.6668 6.98352 18.2387 5.95157 17.4776 5.19046C16.7165 4.42934 15.6845 4.00121 14.6081 4Z";

export function FavoriteButton({
  saved,
  onToggle,
  appearance = "chip",
  className,
}: {
  saved: boolean;
  onToggle: () => void;
  appearance?: "chip" | "bare";
  className?: string;
}) {
  const label = saved ? "Remove from saved homes" : "Save this home";
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
      aria-label={label}
      title={label}
      className={cn(
        "cursor-pointer text-black transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black",
        appearance === "chip"
          ? // The chip is only 23x21; the ::before pad grows the tap
            // target to ~39x37 without changing what's drawn.
            "relative inline-flex h-[21px] w-[23px] items-center justify-center rounded-[3.66px] bg-surface before:absolute before:-inset-2 hover:bg-[#e8e8e8] active:scale-95"
          : "inline-flex size-9 items-center justify-center rounded-full hover:scale-110 active:scale-95",
        className,
      )}
    >
      {appearance === "chip" ? (
        // Figma's 23x21 export, minus the chip rect (drawn by the button).
        <svg
          viewBox="4 4 14.67 12.57"
          className="h-[12.57px] w-[14.67px]"
          fill="currentColor"
          aria-hidden
        >
          <path d={saved ? HEART_SOLID : HEART_OUTLINE} />
        </svg>
      ) : (
        <Heart
          className={cn(
            "size-6 drop-shadow-[0_1px_1.5px_rgba(255,255,255,0.9)]",
            saved && "fill-current",
          )}
          strokeWidth={1.75}
        />
      )}
    </button>
  );
}
