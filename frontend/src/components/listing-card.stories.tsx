import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";

import { ListingCard } from "./listing-card";

// Mirrors Figma Handoff → "Listing Card" (242:34970): Default / Saved /
// Leased / Property, at the component's 238px width. Copy is Figma's.
// This is the only listing card — Discovery Hub and the dashboards all
// render it (API rows go through lib/listing-card-data.ts).

const meta: Meta<typeof ListingCard> = {
  title: "Primitives/ListingCard",
  component: ListingCard,
  tags: ["ai-generated"],
  decorators: [
    (Story) => (
      <div className="w-[238px]">
        <Story />
      </div>
    ),
  ],
  args: {
    heading: "Rent in Accra",
    subtitle: "Loxwood Suite WO4-20",
    price: "GHC 4,000/mo",
    details: ["2 Bedroom", "1 Bathroom"],
    landlord: { name: "Landlord Name", verified: true },
    onToggleFavorite: fn(),
  },
  argTypes: {
    state: {
      control: "inline-radio",
      options: ["default", "saved", "leased", "property"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof ListingCard>;

export const Default: Story = { args: { state: "default" } };
export const Saved: Story = { args: { state: "saved" } };
export const Leased: Story = { args: { state: "leased" } };
export const Property: Story = { args: { state: "property" } };

export const AllStates: Story = {
  render: (args) => (
    <div className="flex w-max gap-6">
      {(["default", "saved", "leased", "property"] as const).map((state) => (
        <div key={state} className="w-[238px]">
          <ListingCard {...args} state={state} />
        </div>
      ))}
    </div>
  ),
};

// Heart toggles, reflects Saved via aria-pressed; Property has no heart.
export const FavoriteToggle: Story = {
  args: { state: "default" },
  play: async ({ canvas, userEvent, args }) => {
    const heart = canvas.getByRole("button", { name: /save this home/i });
    await expect(heart).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(heart);
    await expect(args.onToggleFavorite).toHaveBeenCalledOnce();
  },
};

export const PropertyHasNoHeart: Story = {
  args: { state: "property" },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("button", { name: /save this home/i })).toBeNull();
    await expect(canvas.getByText("Active")).toBeVisible();
    await expect(canvas.getByRole("button", { name: /review document/i })).toBeVisible();
  },
};

// Staff-verified home: "Verified" chip on the photo, top-left, clear of
// the heart. Shows in every state.
export const Verified: Story = {
  args: { state: "saved", verified: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Verified")).toBeVisible();
  },
};

// Landlord's dashboard grid: Property state with the listing's
// lifecycle badge and no action button (the whole card opens it).
export const PropertyBadgeOnly: Story = {
  args: {
    state: "property",
    status: { label: "In review", state: "warning" },
    action: null,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("In review")).toBeVisible();
    await expect(canvas.queryByRole("button")).toBeNull();
  },
};

// With href the whole card is one link; the heart still toggles without
// following it.
export const Linked: Story = {
  args: { state: "default", href: "/homes/loxwood-suite" },
  play: async ({ canvas, userEvent, args }) => {
    await expect(canvas.getByRole("link")).toHaveAttribute("href", "/homes/loxwood-suite");
    await userEvent.click(canvas.getByRole("button", { name: /save this home/i }));
    await expect(args.onToggleFavorite).toHaveBeenCalledOnce();
  },
};

// The single CssCheck for the project: the details line is text-xs
// (12px) — fails if Tailwind / globals.css did not load in preview.
export const CssCheck: Story = {
  args: { state: "default" },
  play: async ({ canvas }) => {
    const details = canvas.getByText("2 Bedroom · 1 Bathroom");
    await expect(getComputedStyle(details).fontSize).toBe("12px");
  },
};
