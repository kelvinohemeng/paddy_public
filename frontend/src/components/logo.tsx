import { cn } from "@/lib/utils";

// paddy wordmark — gradient text approximating Figma's orange→red
// "paddy" lockup (201:2868, Auth section). The MASCOT is still a
// placeholder gap: Figma's Logo is a masked mascot PHOTO the relay
// can't export (structure-only read, no image token — see
// role-card.tsx). Renders text-only until the mascot asset is
// exported and dropped in as a static image/SVG.

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "bg-gradient-to-r from-[#F59E0B] via-[#EA580C] to-[#DC2626] bg-clip-text text-2xl font-bold tracking-tight text-transparent",
        className,
      )}
    >
      paddy
    </span>
  );
}
