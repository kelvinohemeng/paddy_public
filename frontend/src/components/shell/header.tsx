"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { Logo } from "@/components/logo";
import { useSidebar, SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

// Phone-only top bar: the nav is a sheet on small screens, so something
// has to open it. Desktop has no header at all (the Accounts frames show
// none; see layout.tsx), so this renders nothing there.
export const Header = () => {
  const { isMobile } = useSidebar();
  return isMobile ? <MobileHeader /> : null;
};

function MobileHeader() {
  const params = useParams<{ user?: string }>();
  const home = params.user ? `/dashboard/${params.user}` : "/dashboard";

  return (
    <header
      className={cn(
        "sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 bg-white px-3",
      )}
    >
      <SidebarTrigger className="text-subtle-foreground" />
      <Link href={home} aria-label="paddy dashboard home">
        <Logo className="text-[26px]" />
      </Link>
    </header>
  );
}

Header.displayName = "Header";
MobileHeader.displayName = "MobileHeader";
