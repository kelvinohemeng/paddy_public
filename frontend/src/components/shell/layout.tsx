"use client";

import { Header } from "@/components/shell/header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import type { CSSProperties, PropsWithChildren } from "react";
import { Sidebar } from "./sidebar";
import { VerifyEmailBanner } from "./verify-email-banner";

// Dashboard chrome, drawn from the Accounts frames (Figma 181:22493
// Landlord, 174:20049 Renter, 181:23169 Dashboard), read 2026-09-28:
//
//   page    white, 1440 wide in the frames
//   nav     266px column, 32px from the left, 48px from the top
//           (Sidebar below; the sidebar box is 32 + 266 = 298px wide)
//   panel   the rounded sheet holding the page: #f9f9f9 (--color-panel),
//           20px corners, 41px right of the nav, 47px from the top,
//           45px from the right, 48px from the bottom. The chat-free
//           profile frame (181:22659) adds a 1px #d9d9d9 edge, kept here
//           because it's what separates #f9f9f9 from white.
//
// No top header bar on desktop: the frames have none. Logout moved into
// the nav (as in the frames), and the old avatar menu went with the bar.
// Phones keep a slim header (Header → MobileHeader) because the nav
// becomes a sheet there and needs a button to open it.
//
// The frames also have a "Chat with Paddy" tab cut into the panel's top
// right; Kelvin asked for it to be left out (2026-09-28).
//
// The desktop nav is always expanded: the frames show no collapse control,
// so `open` is pinned and the Ctrl/Cmd+B shortcut does nothing. The phone
// sheet has its own open state (openMobile) and still works.
const noop = () => {};

export function Layout({ children }: PropsWithChildren) {
  return (
    <SidebarProvider
      open
      onOpenChange={noop}
      style={{ "--sidebar-width": "16rem" } as CSSProperties}
      className="bg-white"
    >
      <Sidebar />
      <SidebarInset className="min-w-0 bg-white">
        <Header />
        {/* A div, not <main>: SidebarInset already renders the page's one
            <main> landmark. */}
        <div
          className={cn(
            "@container/main",
            "bg-panel border-hairline relative flex min-w-0 flex-1 flex-col border",
            // Phones: a small inset so the sheet still reads as a panel.
            "m-2 rounded-2xl",
            "md:mt-[47px] md:mr-[45px] md:mb-12 md:ml-[12px] md:rounded-[20px]",
            // At least the viewport height minus the margins (1024 − 95 =
            // Figma's 929px panel); longer pages grow and the window scrolls.
            "md:min-h-[calc(100svh-95px)]",
          )}
        >
          {/* The banner renders nothing once the email is verified, which
              leaves this wrapper empty and :empty hides it. */}
          <div className="px-4 pt-4 empty:hidden md:px-8 md:pt-6">
            <VerifyEmailBanner />
          </div>
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

Layout.displayName = "Layout";
