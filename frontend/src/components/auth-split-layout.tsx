"use client";

import PaddyEyes from "./paddy-eyes";

// Shared split layout for Login/Signup, after Figma's Auth section
// (173:18632): a decorative panel on the left (brand gradient + the
// paddy eyes, desktop only) and the form panel on the right.
//
// NOT used by Reset Password — that Figma frame (174:20009) is a
// different, centered single-column layout, not this split.

export function AuthSplitLayout({ children }: { children: React.ReactNode }) {
  return (
    // min-h, not h: a fixed height clips the top of a form taller than
    // the screen (sign-up on a short laptop or a phone held sideways)
    <div className="flex min-h-(--page-h) w-full">
      <div className="hidden flex-1 flex-col items-center justify-center gap-3 bg-[url('/brand/sign-gradient.jpg')] bg-cover bg-no-repeat lg:flex">
        <PaddyEyes curve={0} />
      </div>
      <div className="flex w-full max-w-200 items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
