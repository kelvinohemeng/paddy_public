import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { DashboardButton } from "./dashboard-button";
import { PADDY_ICON_NAMES } from "./paddy-icons";

// Mirrors Figma "Dashboard Button" component set (242:3911): Active /
// Default, driven off the "Paddy Icons" set (242:35101).

const meta: Meta<typeof DashboardButton> = {
  title: "Primitives/DashboardButton",
  component: DashboardButton,
  tags: ["ai-generated"],
  decorators: [
    (Story) => (
      <div className="w-64">
        <Story />
      </div>
    ),
  ],
  args: { icon: "home", label: "Browse Homes" },
};

export default meta;
type Story = StoryObj<typeof DashboardButton>;

export const Default: Story = { args: { active: false } };
export const Active: Story = { args: { active: true } };

// A representative nav stack across the Paddy Icons set.
export const NavStack: Story = {
  render: () => (
    <nav className="flex w-64 flex-col gap-1">
      <DashboardButton icon="home" label="Browse Homes" active />
      <DashboardButton icon="heart" label="Saved Homes" />
      <DashboardButton icon="listings" label="Listings" />
      <DashboardButton icon="lease" label="Leases" />
      <DashboardButton icon="payments" label="Payments" />
      <DashboardButton icon="map" label="Map view" />
      <DashboardButton icon="filter" label="Filters" />
      <DashboardButton icon="profile" label="Profile" />
      <DashboardButton icon="gears" label="Settings" />
      <DashboardButton icon="exit" label="Sign out" />
    </nav>
  ),
};

export const AllIcons: Story = {
  render: () => (
    <div className="grid w-64 grid-cols-2 gap-1">
      {PADDY_ICON_NAMES.map((name) => (
        <DashboardButton key={name} icon={name} label={name} />
      ))}
    </div>
  ),
};
