// Public, unauthenticated layout — sibling to (admin)'s own layout.tsx.
// No sidebar, no /accounts/me/ auth check: everything under this
// route group is meant to be reachable by anonymous visitors and
// search crawlers (SEO is the whole point of this route group per
// AGENTS.md's build-priority #1). Chrome here is intentionally
// minimal for now — a real header/footer belongs to the actual
// Discovery Hub build, not this scaffolding step.

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
