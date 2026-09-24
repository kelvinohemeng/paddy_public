// Public, unauthenticated layout — sibling to (admin)'s own layout.tsx.
// No sidebar, no /accounts/me/ auth check: everything under this
// route group is meant to be reachable by anonymous visitors and
// search crawlers (SEO is the whole point of this route group per
// AGENTS.md's build-priority #1).
//
// `modal` is the @modal parallel-route slot: the listing preview
// drawer when a card is clicked on /homes, otherwise empty
// (@modal/default.tsx).

export default function PublicLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
