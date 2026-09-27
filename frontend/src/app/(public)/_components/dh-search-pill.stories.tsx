import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { DHSearchPill } from "./dh-search-pill";

// Mirrors Figma Handoff → "DH_Search Pill" (280:4317): Rent/Buy tabs
// over the middle third, then Where / Duration / Budget. Place
// suggestions need NEXT_PUBLIC_GOOGLE_MAPS_API_KEY; without it the
// Where field still accepts free text.

const meta: Meta<typeof DHSearchPill> = {
  title: "Discovery/DHSearchPill",
  component: DHSearchPill,
  tags: ["ai-generated"],
  parameters: {
    layout: "padded",
    nextjs: { appDirectory: true, navigation: { pathname: "/homes", query: {} } },
  },
  decorators: [
    (Story) => (
      <div className="py-6">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof DHSearchPill>;

export const Default: Story = {};

// Restores its fields from the URL (back button / shared links).
export const Prefilled: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: "/homes",
        query: {
          city: "East Legon, Accra",
          advance_rent_period: "6_months",
          max_price: "4000",
          listing_type: "buy",
        },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Where")).toHaveValue("East Legon, Accra");
    await expect(canvas.getByLabelText("Budget")).toHaveValue(4000);
    await expect(canvas.getByRole("radio", { name: /buy a property/i })).toBeChecked();
    await expect(canvas.getByRole("button", { name: /duration: 6 months/i })).toBeVisible();
  },
};

// Rent is the default tab; fields show Figma's placeholders.
export const EmptyState: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("radio", { name: /rent a property/i })).toBeChecked();
    await expect(canvas.getByPlaceholderText("Search Destination")).toBeVisible();
    await expect(canvas.getByPlaceholderText("GHC")).toBeVisible();
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile1" } },
};
