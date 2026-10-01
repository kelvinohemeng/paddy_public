import { redirect } from "next/navigation";

// There's no dashboard home page any more (Kelvin, 2026-10-01): its
// sections were smaller copies of My Listings, Saved Homes and the Review
// Queue. Old links and bookmarks to /dashboard/<id> still work: they go
// through /dashboard, which sends each role to its main page.
export default function DashboardUserIndexPage() {
  redirect("/dashboard");
}
