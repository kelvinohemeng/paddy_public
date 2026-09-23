"use client";

import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

// Shared split layout for Login/Signup — mirrors Figma's Auth
// section (173:18632): form panel on the left, a decorative
// illustration panel (#F2F2F2) on the right holding the logo +
// "Character Pose relevant to page" mascot slot. That slot is a
// literal placeholder name IN Figma itself (not this codebase's
// improvisation) — no real illustration has been supplied per
// screen yet, so it renders as a labeled empty panel rather than a
// guessed image.
//
// NOT used by Reset Password — that Figma frame (174:20009) is a
// different, centered single-column layout, not this split.

export function AuthSplitLayout({
  children,
  illustrationLabel = "Illustration",
}: {
  children: React.ReactNode;
  illustrationLabel?: string;
}) {
  return (
    <div className="flex min-h-svh w-full">
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm">{children}</div>
      </div>
      <div
        className={cn(
          "hidden flex-1 flex-col items-center justify-center gap-3 bg-[#F2F2F2] lg:flex",
        )}
      >
        <Logo className="text-3xl" />
        <p className="text-muted-foreground text-sm">{illustrationLabel}</p>
      </div>
    </div>
  );
}
