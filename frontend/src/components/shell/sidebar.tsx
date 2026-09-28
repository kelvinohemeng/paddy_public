"use client";

import React from "react";
import { useParams, usePathname } from "next/navigation";
import { useMe } from "@/hooks/use-auth";
import {
  SidebarRail as ShadcnSidebarRail,
  Sidebar as ShadcnSidebar,
  SidebarContent as ShadcnSidebarContent,
  SidebarHeader as ShadcnSidebarHeader,
  useSidebar as useShadcnSidebar,
  SidebarTrigger as ShadcnSidebarTrigger,
} from "@/components/ui/sidebar";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { DashboardButton } from "@/components/dashboard-button";
import type { PaddyIconName } from "@/components/paddy-icons";
import { DISCOVERY_PATH } from "@/app/(public)/_components/discovery-path";

export function Sidebar() {
  const { open } = useShadcnSidebar();

  return (
    <ShadcnSidebar collapsible="icon" className={cn("border-none")}>
      <ShadcnSidebarRail />
      <SidebarHeader />
      <ShadcnSidebarContent
        className={cn(
          "transition-discrete",
          "duration-200",
          "flex",
          "flex-col",
          // 4px between items, as in the Accounts – Landlord nav.
          "gap-1",
          "pt-2",
          "pb-2",
          "border-r",
          "border-border",
          {
            "px-3": open,
            "px-1": !open,
          }
        )}
      >
        {/* The dashboard nav: user-scoped links (Home, Discover,
            Listings, …) resolved with the real user id. Everything the
            old Refine useMenu() contributed was hidden anyway — these
            workspace links were always the entire menu. */}
        <WorkspaceLinks />
      </ShadcnSidebarContent>
    </ShadcnSidebar>
  );
}

// Role-aware dashboard links, resolved with the real user id.
//
// Visibility mirrors the backend's own scoping (same matrix the old
// dashboard-nav.tsx used):
//   - Home + Discover + Leases + Profile → everyone
//   - Listings                            → landlord / staff / admin
//   - Reviews                             → staff / admin
//   - Saved Homes                         → renter only
// The user id comes from the route params (synchronous — links render
// on first paint instead of waiting for identity); identity only
// supplies the role gate, and every link renders while the role is
// still loading, narrowing once it arrives. Pages re-check roles
// themselves and the backend 403s regardless, so this gate is
// navigation, not security.
//
// Each row is the Figma DashboardButton (Handoff 242:3911). Same items
// and routes as before — only the look changed. The Figma screens'
// own nav items (Browse Homes, About me, Payment, Settings…) are a
// separate, later change. Icons come from the Paddy Icons set; Reviews
// has no glyph there, so it keeps lucide's ShieldCheck.
function WorkspaceLinks() {
  const params = useParams<{ user: string }>();
  const { data: identity } = useMe();
  const pathname = usePathname();
  const { open, isMobile, setOpenMobile } = useShadcnSidebar();

  // Route param first (every dashboard page carries [user]); identity
  // id only as a fallback for admin pages without that segment. No
  // user id from either → no valid hrefs, render nothing.
  const userId = params.user ?? identity?.id;
  const role: string | undefined = identity?.role;
  if (!userId) return null;

  const links: {
    href: string;
    label: string;
    icon: PaddyIconName | typeof ShieldCheck;
    visible: boolean;
  }[] = [
    {
      href: `/dashboard/${userId}`,
      label: "Home",
      icon: "home",
      visible: true,
    },
    {
      href: DISCOVERY_PATH,
      label: "Discover",
      icon: "map",
      // Public hub — every role browses listings, so this is always
      // shown (same as the old DashboardNav's Discover entry).
      visible: true,
    },
    {
      href: `/dashboard/${userId}/listings`,
      label: "Listings",
      icon: "listings",
      // Role undefined while identity loads (or if it fails) — render,
      // then narrow once the role arrives.
      visible:
        !role || ["landlord", "staff", "admin"].includes(role),
    },
    {
      href: `/dashboard/${userId}/leases`,
      label: "Leases",
      icon: "lease",
      visible: true,
    },
    {
      href: `/dashboard/${userId}/reviews`,
      label: "Reviews",
      icon: ShieldCheck,
      // Staff/admin only; shown while the role loads, narrowed after.
      // The page re-checks, the backend 403s regardless.
      visible: !role || ["staff", "admin"].includes(role),
    },
    {
      href: `/dashboard/${userId}/saved`,
      label: "Saved Homes",
      icon: "heart",
      // Renter only; shown while the role loads, narrowed after.
      visible: !role || role === "renter",
    },
    {
      href: `/dashboard/${userId}/profile`,
      label: "Profile",
      icon: "profile",
      visible: true,
    },
  ];

  return (
    <>
      {links
        .filter((l) => l.visible)
        .map(({ href, label, icon }) => {
          // Exact match for Home (every dashboard URL starts with it),
          // prefix match for the section links.
          const isHome = href.split("/").length === 3;
          const isSelected = isHome
            ? pathname === href
            : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <DashboardButton
              key={href}
              href={href}
              icon={icon}
              label={label}
              active={isSelected}
              // The collapsed desktop rail is icon-only. The phone sheet
              // always shows labels (`open` describes the desktop rail).
              collapsed={!open && !isMobile}
              // On phones the nav is a sheet over the page: close it
              // once a link is picked so the new page is visible.
              onClick={isMobile ? () => setOpenMobile(false) : undefined}
              // 44px rows, as every instance in the Accounts – Landlord
              // screens overrides the set's 40px (e.g. 288:8272).
              className="h-11 py-3"
            />
          );
        })}
    </>
  );
}

function SidebarHeader() {
  const { open, isMobile } = useShadcnSidebar();

  return (
    <ShadcnSidebarHeader
      className={cn(
        "p-0",
        "h-16",
        "border-b",
        "border-border",
        "flex-row",
        "items-center",
        "justify-between",
        "overflow-hidden"
      )}
    >
      <div
        className={cn(
          "whitespace-nowrap",
          "flex",
          "flex-row",
          "h-full",
          "items-center",
          "justify-start",
          "gap-2",
          "transition-discrete",
          "duration-200",
          {
            "pl-3": !open,
            "pl-5": open,
          }
        )}
      >
        <Logo className={cn("text-xl", { "hidden": !open })} />
      </div>

      <ShadcnSidebarTrigger
        className={cn("text-muted-foreground", "mr-1.5", {
          "opacity-0": !open,
          "opacity-100": open || isMobile,
          "pointer-events-auto": open || isMobile,
          "pointer-events-none": !open && !isMobile,
        })}
      />
    </ShadcnSidebarHeader>
  );
}

Sidebar.displayName = "Sidebar";
