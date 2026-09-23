import Link from "next/link";

// Framework-free 404: plain markup + links, no auth wrapper. The
// (admin) layout still gates dashboard routes server-side; this page
// just needs to point lost visitors somewhere useful.
export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-6xl font-bold">404</p>
      <h1 className="text-2xl font-semibold">This page doesn&apos;t exist</h1>
      <p className="text-muted-foreground max-w-sm text-sm">
        The link you followed may be broken, or the page may have been
        removed.
      </p>
      <div className="flex gap-4 text-sm font-medium">
        <Link href="/" className="underline">
          Discover homes
        </Link>
        <Link href="/dashboard" className="underline">
          Dashboard
        </Link>
        <Link href="/login" className="underline">
          Sign in
        </Link>
      </div>
    </div>
  );
}
