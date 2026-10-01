import { cn } from "@/lib/utils";

// paddy logo — Figma "Logo" component (used at the top of every Accounts
// frame, e.g. 181:22561), read 2026-09-28 via the Figma plugin API:
//   mascot  36x40, masked photo, exported at 3x to
//           public/brand/paddy-mascot.png (108x122, transparent)
//   gap     5.9px
//   "paddy" Clash Display Medium 39.6px, -3% tracking, linear gradient
//           #fba213 → #af1624, running left to right and ~24° downward
//           (from the fill's gradientTransform)
//
// Everything is sized in em, so the lockup scales with the font size the
// caller sets (text-3xl on the auth pages, 40px in the dashboard sidebar)
// and keeps Figma's proportions: mascot ≈1em tall, gap ≈0.15em.
//
// `mascot={false}` gives the wordmark alone, for tight spots.

export function Logo({
  className,
  mascot = true,
}: {
  className?: string;
  mascot?: boolean;
}) {
  return (
    <span
      className={cn(
        "font-display inline-flex items-center gap-[0.15em] text-2xl leading-none font-medium tracking-[-0.03em]",
        className,
      )}
    >
      {mascot && (
        // Decorative: the wordmark next to it already names the brand.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/brand/Logo.png"
          alt=""
          aria-hidden
          width={108}
          height={122}
          className="h-[1.01em] w-auto shrink-0"
        />
      )}
    </span>
  );
}
