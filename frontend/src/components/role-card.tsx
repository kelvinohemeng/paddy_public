import { VerifiedSealIcon } from "@/components/paddy-icons";
import { cn } from "@/lib/utils";

// paddy role card primitive — the "who are you" picker on onboarding
// (Landlord / Renter).
// Spec: Figma Handoff → "Role Card" component set (242:3862), 3 states,
// read 2026-09-27 via the Figma plugin API:
//
//            fill                         seal   shadow      opacity
//  Selected  gradient #dc2027 → #761115   white  Cards       1
//  Default   white                        none   none        1
//  Muted     white                        black  Cards       0.5
//
// All three: 178x106, 20px padding, 12px radius, 1px #d9d9d9 outline
// drawn OUTSIDE the box (Figma stroke align "outside" — a ring shadow
// here, so it doesn't eat into the padding). "Cards" is the file's
// effect style: 0 4px 27.6px 3px black at 10% (`shadow-card`).
//
// Type: "You are" is Plus Jakarta Sans Medium 10 at 80% opacity; the
// role is Clash Display Medium 18. Both at -2% letter spacing.
//
// The corner mark is the verified seal (Phosphor SealCheck). An
// earlier version guessed a solid blue for Selected because the old
// Figma relay couldn't read gradients; this is the real fill.

export type RoleCardState = "selected" | "default" | "muted";

const STATE_CLASSES: Record<RoleCardState, string> = {
  selected:
    "bg-brand-gradient text-white shadow-[0_0_0_1px_#d9d9d9,var(--shadow-card)]",
  default:
    "bg-white text-black shadow-[0_0_0_1px_#d9d9d9] hover:shadow-[0_0_0_1px_#d9d9d9,var(--shadow-card)]",
  muted:
    "bg-white text-black opacity-50 shadow-[0_0_0_1px_#d9d9d9,var(--shadow-card)]",
};

export function RoleCard({
  role,
  state = "default",
  onSelect,
  className,
}: {
  /** e.g. "Landlord", "Renter" */
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
        // w-[178px] is the Figma component default; screens that lay
        // two cards side by side override it via className.
        "flex h-[106px] w-[178px] cursor-pointer flex-col justify-between rounded-xl p-5 text-left transition-[box-shadow,background-color] outline-none",
        "focus-visible:ring-2 focus-visible:ring-[#3b82f6]/60 focus-visible:ring-offset-2",
        STATE_CLASSES[state],
        muted && "cursor-not-allowed",
        className,
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-label text-[10px] font-medium tracking-[-0.02em] opacity-80">
          You are
        </span>
        {state !== "default" && <VerifiedSealIcon className="shrink-0" />}
      </span>
      <span className="font-display text-lg leading-[22px] font-medium tracking-[-0.02em]">
        {role}
      </span>
    </button>
  );
}
