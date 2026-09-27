import { cn } from "@/lib/utils";

// The one grid every listing-card list uses (Discovery Hub, dashboard
// Listings) — 3 columns wherever there's room for them.
//
// Columns follow the width of the grid's own container, not the
// viewport (Tailwind container queries): Discovery's list pane is only
// half the screen next to the map, the dashboard's is the full content
// area, and both should get 3 columns once THEY are wide enough —
// 36rem+ (~190px cards). Narrower drops to 2, then 1 on phones, where
// three ~110px cards would be unreadable.
export function ListingGrid({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="@container">
      <div
        className={cn(
          "grid grid-cols-1 content-start gap-x-4 gap-y-8 @sm:grid-cols-2 @xl:grid-cols-3",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
