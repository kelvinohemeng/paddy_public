"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { ChartColumn, ShieldCheck, Wrench, type LucideIcon } from "lucide-react";

import { useLogout, useMe } from "@/hooks/use-auth";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent as ShadcnSidebarContent,
  SidebarHeader as ShadcnSidebarHeader,
  useSidebar as useShadcnSidebar,
  SidebarFooter, SidebarMenu, SidebarMenuItem, SidebarMenuButton
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
// The rows themselves are set per role (Kelvin, 2026-10-01), with the
// frames' look but not their exact list — see navFor() below:
//   landlord        My Listings · Analytics (soon) | Payment · About me
//   renter          Browse Homes · Saved Homes | About me
//   staff           Review Queue · Browse Homes | About me
//   admin           Review Queue · Admin panel ↗ · Browse Homes | About me
//   everyone        | Logout
//
// Gone since the frames: "Dashboard" (there's no dashboard home page any
// more — /dashboard opens each role's main page, see
// app/(admin)/dashboard/page.tsx) and "Active Lease" (leases are out of
// the MVP; the pages and backend stay, unlinked).
//
// Left out until they have pages behind them: Settings, Viewings,
// Unlocked Listings and the renter's Payment row. A nav row
// that 404s is worse than no row. Marker comments in navFor() show where
// each one goes. Analytics is the one deliberate exception: shown
// disabled with a "Soon" badge, so landlords know it's coming.
//
// Role-specific rows appear once identity has loaded, so a renter never
// sees landlord rows flash in and out. Pages re-check roles themselves and
// the backend 403s regardless — this is navigation, not security.

type NavItem = {
  href: string;
  label: string;
  icon: PaddyIconName | LucideIcon;
  /** Shown disabled with a "Soon" badge: the page doesn't exist yet. */
  soon?: boolean;
  /** Leaves the app (new tab). */
  external?: boolean;
};

type NavGroupsForRole = {
  main: NavItem[];
  // Plan, billing and profile: the frames' second group.
  account: NavItem[];
};

// Django admin, on the backend. Only the admin role gets this row: staff
// accounts can't sign in to Django admin yet (they don't have is_staff),
// so for them it would be a dead end.
const DJANGO_ADMIN_URL = `${process.env.NEXT_PUBLIC_API_URL}/admin/`;

function navFor(role: string | undefined, base: string): NavGroupsForRole {
  const browseHomes: NavItem = { href: DISCOVERY_PATH, label: "Browse Homes", icon: "map" };
  const aboutMe: NavItem = { href: `${base}/profile`, label: "About me", icon: "profile" };

  switch (role) {
    case "landlord":
      return {
        main: [
          { href: `${base}/listings`, label: "My Listings", icon: "listings" },
          // Viewings row goes here once the viewings page exists.
          { href: `${base}/analytics`, label: "Analytics", icon: ChartColumn, soon: true },
        ],
        account: [
          // Their plan and billing — the subscription card lives there.
          { href: `${base}/payment`, label: "Payment", icon: "payments" },
          aboutMe,
        ],
      };
    case "renter":
      return {
        main: [
          browseHomes,
          // Unlocked Listings row goes here once that page exists.
          { href: `${base}/saved`, label: "Saved Homes", icon: "heart" },
          // Viewings row goes here once the viewings page exists.
        ],
        account: [
          // Payment row goes here once renters have receipts to show.
          aboutMe,
        ],
      };
    case "staff":
    case "admin":
      return {
        main: [
          { href: `${base}/reviews`, label: "Review Queue", icon: ShieldCheck },
          // Viewings row goes here once the viewings page exists.
          ...(role === "admin"
            ? [{ href: DJANGO_ADMIN_URL, label: "Admin panel", icon: Wrench, external: true }]
            : []),
          browseHomes,
        ],
        account: [aboutMe],
      };
    default:
      // Identity still loading, or no role yet (onboarding not finished,
      // and /dashboard sends those users to /onboarding anyway).
      return { main: [], account: [] };
  }
}

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
          isMobile ? "px-2 pt-6" : "pt-10 pr-0 pl-3",
        )}
      >
        <NavGroups />
      </ShadcnSidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton>
               Username
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </ShadcnSidebar>
  );
}

function SidebarLogo() {
  const { isMobile, setOpenMobile } = useShadcnSidebar();

  return (
    <ShadcnSidebarHeader
      className={cn("gap-0 p-0", isMobile ? "px-4 pt-5" : "pt-12 pl-8")}
    >
      <Link
        // "/dashboard" works out the role's main page on the server
        // (My Listings, Review Queue or Saved Homes).
        href="/dashboard"
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

  const { main, account } = navFor(role, `/dashboard/${userId}`);

  // Prefix match, so a listing's own page keeps My Listings lit.
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  // On phones the nav is a sheet over the page: close it once a row is
  // picked so the new page is visible.
  const closeSheet = isMobile ? () => setOpenMobile(false) : undefined;

  const row = ({ href, label, icon, soon, external }: NavItem) => (
    <DashboardButton
      key={href}
      href={href}
      icon={icon}
      label={label}
      active={!soon && !external && isActive(href)}
      disabled={soon}
      badge={soon ? "Soon" : undefined}
      external={external}
      onClick={closeSheet}
      // 44px rows: every instance in the Accounts screens overrides the
      // set's 40px (e.g. 288:8272).
      className="h-11 py-3"
    />
  );

  return (
    <nav aria-label="Dashboard" className="flex flex-col gap-6">
      {main.length > 0 && (
        <>
          <div className="flex flex-col gap-1">{main.map(row)}</div>
          <NavRule />
        </>
      )}
      {account.length > 0 && (
        <>
          <div className="flex flex-col gap-1">{account.map(row)}</div>
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
