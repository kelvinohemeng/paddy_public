"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

// Global toast outlet, mounted once inside QueryProvider. paddy is
// light-theme only, so the theme is pinned — no theme hook, no toggle.
export function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}
