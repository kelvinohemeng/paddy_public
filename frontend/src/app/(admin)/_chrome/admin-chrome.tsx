"use client";

import { Layout } from "@/components/shell/layout";

// Client chrome for the (admin) section. The auth/role checks stay in
// the SERVER layout directly below; this wrapper exists only because
// the Layout/Sidebar/Header are client components (they call
// useMe/useLogout, which need the QueryClient context) — a server
// layout can't render them directly with server-rendered children
// unless it goes through an intermediate client component.
//
// The `modal` slot is passed through untouched — it renders as a SIBLING
// flex column of the docked aside (see the server layout below), NOT as
// a child of the sidebar's main area, so the intercepted create/edit/
// preview panels keep squeezing the page content exactly as before.
export function AdminChrome({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full items-stretch">
      {/* min-w-0 flex-1: without min-w-0, wide dashboard content could
          refuse to shrink and push the docked @modal panel off-screen. */}
      <div className="min-w-0 flex-1">
        <Layout>{children}</Layout>
      </div>
      {modal}
      {/* Parallel-route slot rendered as a SIBLING flex column, not an
          overlay — when @modal/default.tsx is active (null) this adds
          nothing and children take full width; when the intercepted
          create route is active, its <aside> docks on the right and
          physically squeezes children, so the panel occupies space in
          the layout instead of floating over it. */}
    </div>
  );
}
