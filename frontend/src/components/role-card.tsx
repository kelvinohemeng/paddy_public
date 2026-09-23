import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

// paddy role card primitive — Medusa-referenced, shadcn-built.
// Spec: Handoff → "Role Card" component set (242:3862), 3 states:
// Selected / Default / Muted. Used for the auth "who are you"
// picker (Landlord / Renter / Agent...).
//
// Improv decision, confirmed with Kelvin 2026-09-23: Figma's Selected
// state uses a GRADIENT_LINEAR fill the relay snapshot can't resolve
// to real color stops (structure-only read, no image export token
// available per figma-plugin AGENT.md). Rather than guess stops,
// Selected renders as a solid brand-primary fill (bg-primary / the
// app's `--primary` token, same blue used everywhere else) — confirm
// against Figma again if/when the plugin gains image-export.
//
// Muted renders identically to Default except for a dimmed label +
// disabled interaction (Figma's two variants read the same fills in
// the snapshot; muted = lower-opacity + non-interactive is the
// standard reading of "muted" elsewhere in this set).

export type RoleCardState = "selected" | "default" | "muted";

const STATE_CLASSES: Record<RoleCardState, string> = {
  selected: "bg-primary text-primary-foreground border-transparent",
  default: "bg-white text-[#111111] border-input hover:border-[#262629]/40",
  muted: "bg-white text-[#A1A1AA] border-input opacity-60",
};

export function RoleCard({
  role,
  state = "default",
  onSelect,
  className,
}: {
  /** e.g. "Landlord", "Renter", "Agent" */
  role: string;
  state?: RoleCardState;
  onSelect?: () => void;
  className?: string;
}) {
  const muted = state === "muted";
  return (
    <button
      type="button"
      disabled={muted}
      aria-pressed={state === "selected"}
      onClick={onSelect}
      className={cn(
        // w-[178px] is the Figma component-library default; auth
        // screens (Signup, 145px cards side by side) override via
        // className — kept flexible instead of hardcoded so both
        // contexts get their real Figma proportions.
        "flex h-[106px] w-[178px] flex-col justify-between rounded-xl border p-5 text-left shadow-xs transition",
        STATE_CLASSES[state],
        muted && "cursor-not-allowed",
        className,
      )}
    >
      <span className="flex items-center justify-between text-[10px] font-medium tracking-wide uppercase opacity-80">
        You are
        <ChevronRight className="size-2.5" aria-hidden />
      </span>
      <span className="text-lg font-semibold">{role}</span>
    </button>
  );
}
