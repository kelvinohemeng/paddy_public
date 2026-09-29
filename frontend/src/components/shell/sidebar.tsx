"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { useLogout, useMe } from "@/hooks/use-auth";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent as ShadcnSidebarContent,
  SidebarHeader as ShadcnSidebarHeader,
  useSidebar as useShadcnSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { DashboardButton } from "@/components/dashboard-button";
import type { PaddyIconName } from "@/components/paddy-icons";
import { DISCOVERY_PATH } from "@/app/(public)/_components/discovery-path";

// The dashboard nav, drawn from the Accounts frames (Figma 181:22493
// Landlord, 174:20049 Renter), read 2026-09-28:
//
//   Logo (mascot + wordmark), then 40px down, the nav: groups of 44px
//   Dashboard Buttons, 4px apart, 24px between groups, with a 1px #d9d9d9
//   rule between them.
//
//   Renter frames    Dashboard · Browse Homes · About me · Active Lease ·
//                    Saved Homes | Payment | Settings · Logout
//   Landlord frames  Browse Homes · About me · Active Lease · My Listings |
//                    Payment | Settings · Logout
//
// What's built from that, per role:
//   everyone        Dashboard (the landlord frames skip it, but every role
//                   has a home page, so it stays), Browse Homes, About me,
//                   Active Lease, Logout
//   landlord        My Listings, and Payment (their plan and billing —
//                   the subscription card lives there now)
//   renter          Saved Homes
//   staff / admin   Review Queue (no Figma frame; same row, lucide icon)
//
// Left out until they have pages behind them: Settings (there are no
// settings yet) and Payment for renters (there's no endpoint listing a
// renter's unlock payments). A nav row that 404s is worse than no row.
//
// Role-specific rows appear once identity has loaded, so a renter never
// sees landlord rows flash in and out. Pages re-check roles themselves and
// the backend 403s regardless — this is navigation, not security.

type NavItem = {
  href: string;
  label: string;
  icon: PaddyIconName | typeof ShieldCheck;
};

export function Sidebar() {
  const { isMobile } = useShadcnSidebar();

  return (
    <ShadcnSidebar collapsible="icon" className="border-none">
      <SidebarLogo />
      <ShadcnSidebarContent
        className={cn(
          "flex flex-col gap-6 pb-8",
          // Desktop: 32px in from the page edge, 40px under the logo, and
          // the 266px column runs to the sidebar's right edge. The phone
          // sheet is narrower, so it gets an even inset instead.
          isMobile ? "px-4 pt-6" : "pt-10 pr-0 pl-8",
        )}
      >
        <NavGroups />
      </ShadcnSidebarContent>
    </ShadcnSidebar>
  );
}

function SidebarLogo() {
  const params = useParams<{ user?: string }>();
  const { data: identity } = useMe();
  const { isMobile, setOpenMobile } = useShadcnSidebar();
  const userId = params.user ?? identity?.id;

  return (
    <ShadcnSidebarHeader
      className={cn("gap-0 p-0", isMobile ? "px-4 pt-5" : "pt-12 pl-8")}
    >
      <Link
        href={userId ? `/dashboard/${userId}` : "/dashboard"}
        aria-label="paddy dashboard home"
        onClick={isMobile ? () => setOpenMobile(false) : undefined}
        // flex, so the link is exactly the logo's height (an inline box
        // would add the line-height gap under it and push the nav down).
        className="flex w-fit rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Logo className={isMobile ? "text-[30px]" : "text-[40px]"} />
      </Link>
    </ShadcnSidebarHeader>
  );
}

function NavGroups() {
  const params = useParams<{ user: string }>();
  const { data: identity } = useMe();
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useShadcnSidebar();
  const { mutate: logout, isPending: isLoggingOut } = useLogout();

  // Route param first (every dashboard page carries [user]); identity id
  // as a fallback for admin pages without that segment.
  const userId = params.user ?? identity?.id;
  const role: string | undefined = identity?.role;
  if (!userId) return null;

  const base = `/dashboard/${userId}`;

  const main: NavItem[] = [
    { href: base, label: "Dashboard", icon: "home" },
    // The public hub: every role browses homes.
    { href: DISCOVERY_PATH, label: "Browse Homes", icon: "map" },
    { href: `${base}/profile`, label: "About me", icon: "profile" },
    { href: `${base}/leases`, label: "Active Lease", icon: "lease" },
  ];
  if (role === "landlord") {
    main.push({ href: `${base}/listings`, label: "My Listings", icon: "listings" });
  }
  if (role === "renter") {
    main.push({ href: `${base}/saved`, label: "Saved Homes", icon: "heart" });
  }
  if (role === "staff" || role === "admin") {
    main.push({ href: `${base}/reviews`, label: "Review Queue", icon: ShieldCheck });
  }

  const billing: NavItem[] =
    role === "landlord"
      ? [{ href: `${base}/payment`, label: "Payment", icon: "payments" }]
      : [];

  // Exact match for Dashboard (every dashboard URL starts with it), prefix
  // match for the rest.
  const isActive = (href: string) =>
    href === base
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);

  // On phones the nav is a sheet over the page: close it once a row is
  // picked so the new page is visible.
  const closeSheet = isMobile ? () => setOpenMobile(false) : undefined;

  const row = ({ href, label, icon }: NavItem) => (
    <DashboardButton
      key={href}
      href={href}
      icon={icon}
      label={label}
      active={isActive(href)}
      onClick={closeSheet}
      // 44px rows: every instance in the Accounts screens overrides the
      // set's 40px (e.g. 288:8272).
      className="h-11 py-3"
    />
  );

  return (
    <nav aria-label="Dashboard" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">{main.map(row)}</div>
      <NavRule />
      {billing.length > 0 && (
        <>
          <div className="flex flex-col gap-1">{billing.map(row)}</div>
          <NavRule />
        </>
      )}
      <div className="flex flex-col gap-1">
        <DashboardButton
          icon="exit"
          label={isLoggingOut ? "Logging out…" : "Logout"}
          onClick={() => logout()}
          className="h-11 py-3"
        />
      </div>
    </nav>
  );
}

// Figma "Vector 6/7": a 1px #d9d9d9 rule across the nav column.
function NavRule() {
  return <hr className="border-hairline" />;
}

Sidebar.displayName = "Sidebar";
