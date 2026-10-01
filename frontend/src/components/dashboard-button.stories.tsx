import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ChartColumn, ShieldCheck, Wrench } from "lucide-react";
import { expect } from "storybook/test";

import { DashboardButton } from "./dashboard-button";
import { PADDY_ICON_NAMES } from "./paddy-icons";

// Mirrors Figma Handoff → "Dashboard Button" (242:3911): State Active /
// Default, driven off the "Paddy Icons" set (242:35101). The set's two
// plus-mini marks (11:1354) are hidden in both states; the *Marks stories
// show them switched on. Hover and keyboard focus aren't in the set —
// see the component's header comment.

const meta: Meta<typeof DashboardButton> = {
  title: "Primitives/DashboardButton",
  component: DashboardButton,
  tags: ["ai-generated"],
  decorators: [
    (Story) => (
      <div className="w-[266px] bg-white p-2">
        <Story />
      </div>
    ),
  ],
  args: { icon: "home", label: "Browse Homes" },
};

export default meta;
type Story = StoryObj<typeof DashboardButton>;

// Figma State=Default.
export const Default: Story = { args: { active: false } };

// Figma State=Active.
export const Active: Story = {
  args: { active: true, href: "/dashboard" },
  play: async ({ canvas }) => {
    const link = canvas.getByRole("link", { name: /browse homes/i });
    await expect(link).toHaveAttribute("aria-current", "page");
  },
};

// Figma's hidden plus-mini instances, switched on.
export const DefaultWithMarks: Story = {
  args: { active: false, leadingMark: true, trailingMark: true },
};
export const ActiveWithMarks: Story = {
  args: { active: true, leadingMark: true, trailingMark: true },
};

// Collapsed sidebar rail: icon only, the label becomes the accessible name.
export const Collapsed: Story = {
  args: { collapsed: true, href: "/dashboard" },
  decorators: [
    (Story) => (
      <div className="w-12">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("link", { name: /browse homes/i }),
    ).toBeInTheDocument();
  },
};

// An item the Paddy Icons set has no glyph for takes any icon component.
export const WithLucideIcon: Story = {
  args: { icon: ShieldCheck, label: "Reviews" },
};

// Not in the Figma set: a page that doesn't exist yet (the landlord's
// Analytics row). Muted, not clickable, with a "Soon" badge.
export const ComingSoon: Story = {
  args: {
    icon: ChartColumn,
    label: "Analytics",
    href: "/dashboard",
    disabled: true,
    badge: "Soon",
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("link")).not.toBeInTheDocument();
    await expect(canvas.getByText("Analytics").closest("[aria-disabled]")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  },
};

// Not in the Figma set: a row that leaves the app (the admin's Django
// admin link) opens in a new tab.
export const External: Story = {
  args: {
    icon: Wrench,
    label: "Admin panel",
    href: "https://example.com/admin/",
    external: true,
  },
  play: async ({ canvas }) => {
    const link = canvas.getByRole("link", { name: /admin panel/i });
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  },
};

// The Accounts – Landlord sidebar (181:22625): 44px instances (padding
// overridden to 12/16), 4px apart, groups split by a #d9d9d9 hairline.
export const NavStack: Story = {
  render: () => (
    <nav className="flex w-[266px] flex-col gap-6">
      <div className="flex flex-col gap-1">
        <DashboardButton icon="map" label="Browse Homes" className="h-11 py-3" />
        <DashboardButton icon="profile" label="About me" className="h-11 py-3" />
        <DashboardButton icon="lease" label="Active Lease" className="h-11 py-3" />
        <DashboardButton icon="listings" label="My Listings" active className="h-11 py-3" />
      </div>
      <hr className="border-hairline" />
      <DashboardButton icon="payments" label="Payment" className="h-11 py-3" />
      <hr className="border-hairline" />
      <div className="flex flex-col gap-1">
        <DashboardButton icon="gears" label="Settings" className="h-11 py-3" />
        <DashboardButton icon="exit" label="Logout" className="h-11 py-3" />
      </div>
    </nav>
  ),
};

export const AllIcons: Story = {
  render: () => (
    <div className="grid w-[532px] grid-cols-2 gap-1">
      {PADDY_ICON_NAMES.map((name) => (
        <DashboardButton key={name} icon={name} label={name} />
      ))}
    </div>
  ),
};
