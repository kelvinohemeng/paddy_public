import {
  Heart,
  CreditCard,
  User,
  Home,
  Map,
  Building2,
  Settings,
  FileText,
  LogOut,
  Filter,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// paddy icon set — Medusa-referenced, shadcn-built.
// Spec: Handoff → "Paddy Icons" component set (242:35101), 10 named
// slots: Heart, Payments, Profile, Home, Map, Listings, Gears, Lease,
// Exit, Filter — all 20x20 in Figma.
//
// Improv decision: the relay snapshot only carries solid fills, not
// vector path data, so custom glyphs can't be reconstructed pixel-
// exact from a read. Each slot is mapped to its closest lucide-react
// icon instead (same approach as PaddyButton's icon slots) — swap
// for real SVG exports if/when the plugin gains an image-export
// command (see AGENT.md: "image renders ... NOT portal jobs").

export type PaddyIconName =
  | "heart"
  | "payments"
  | "profile"
  | "home"
  | "map"
  | "listings"
  | "gears"
  | "lease"
  | "exit"
  | "filter";

const ICON_MAP: Record<PaddyIconName, LucideIcon> = {
  heart: Heart,
  payments: CreditCard,
  profile: User,
  home: Home,
  map: Map,
  listings: Building2,
  gears: Settings,
  lease: FileText,
  exit: LogOut,
  filter: Filter,
};

export const PADDY_ICON_NAMES = Object.keys(ICON_MAP) as PaddyIconName[];

export function PaddyIcon({
  name,
  className,
  ...props
}: { name: PaddyIconName } & React.ComponentProps<"svg">) {
  const Icon = ICON_MAP[name];
  return <Icon className={cn("size-5", className)} aria-hidden {...props} />;
}
