"use client";

import React from "react";
import Link from "next/link";
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
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Building2,
  FileText,
  Heart,
  Map,
  User,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
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
          "gap-2",
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
function WorkspaceLinks() {
  const params = useParams<{ user: string }>();
  const { data: identity } = useMe();
  const pathname = usePathname();

  // Route param first (every dashboard page carries [user]); identity
  // id only as a fallback for admin pages without that segment. No
  // user id from either → no valid hrefs, render nothing.
  const userId = params.user ?? identity?.id;
  const role: string | undefined = identity?.role;
  if (!userId) return null;

  const links = [
    {
      href: `/dashboard/${userId}`,
      label: "Home",
      icon: <LayoutDashboard className="w-4" />,
      visible: true,
    },
    {
      href: DISCOVERY_PATH,
      label: "Discover",
      icon: <Map className="w-4" />,
      // Public hub — every role browses listings, so this is always
      // shown (same as the old DashboardNav's Discover entry).
      visible: true,
    },
    {
      href: `/dashboard/${userId}/listings`,
      label: "Listings",
      icon: <Building2 className="w-4" />,
      // Role undefined while identity loads (or if it fails) — render,
      // then narrow once the role arrives.
      visible:
        !role || ["landlord", "staff", "admin"].includes(role),
    },
    {
      href: `/dashboard/${userId}/leases`,
      label: "Leases",
      icon: <FileText className="w-4" />,
      visible: true,
    },
    {
      href: `/dashboard/${userId}/reviews`,
      label: "Reviews",
      icon: <ShieldCheck className="w-4" />,
      // Staff/admin only; shown while the role loads, narrowed after.
      // The page re-checks, the backend 403s regardless.
      visible: !role || ["staff", "admin"].includes(role),
    },
    {
      href: `/dashboard/${userId}/saved`,
      label: "Saved Homes",
      icon: <Heart className="w-4" />,
      // Renter only; shown while the role loads, narrowed after.
      visible: !role || role === "renter",
    },
    {
      href: `/dashboard/${userId}/profile`,
      label: "Profile",
      icon: <User className="w-4" />,
      visible: true,
    },
  ].filter((l) => l.visible);

  return (
    <>
      {links.map(({ href, label, icon }) => {
        // Exact match for Home (every dashboard URL starts with it),
        // prefix match for the section links.
        const isHome = href.split("/").length === 3;
        const isSelected = isHome
          ? pathname === href
          : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Button
            key={href}
            asChild
            variant="ghost"
            size="lg"
            className={cn(
              "flex w-full items-center justify-start gap-2 py-2 !px-3 text-sm",
              {
                "bg-sidebar-primary": isSelected,
                "hover:!bg-sidebar-primary/90": isSelected,
                "text-sidebar-primary-foreground": isSelected,
              }
            )}
          >
            <Link
              href={href}
              className={cn("flex w-full items-center gap-2")}
            >
              <div
                className={cn("w-4", {
                  "text-muted-foreground": !isSelected,
                  "text-sidebar-primary-foreground": isSelected,
                })}
              >
                {icon}
              </div>
              <span
                className={cn("line-clamp-1 truncate", {
                  "font-normal": !isSelected,
                  "font-semibold": isSelected,
                  "text-sidebar-primary-foreground": isSelected,
                  "text-foreground": !isSelected,
                })}
              >
                {label}
              </span>
            </Link>
          </Button>
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
