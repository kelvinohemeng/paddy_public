"use client";

import { Layout } from "@/components/shell/layout";

// Client chrome for the (admin) section. The auth/role checks stay in
// the SERVER layout directly below; this wrapper exists only because
// the Layout/Sidebar/Header are client components (they call
// useMe/useLogout, which need the QueryClient context) — a server
// layout can't render them directly with server-rendered children
// unless it goes through an intermediate client component.
//
// The `modal` slot is passed through untouched. The intercepted listing
// create / preview / edit routes render a <SideDrawer>, which portals
// itself over the page (same drawer as Discovery's listing preview), so
// the slot takes no space in this layout.
export function AdminChrome({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-red-400 w-full items-stretch">
      <div className="min-w-0 flex-1 ">
        <Layout>{children}</Layout>
      </div>
      {/* null (@modal/default.tsx) or a portaled SideDrawer. */}
      {modal}
    </div>
  );
}
