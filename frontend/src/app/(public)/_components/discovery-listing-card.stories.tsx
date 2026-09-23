import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import {
  DiscoveryListingCard,
  type PublicListing,
} from "./discovery-listing-card";

// Mirrors Figma "Listing Card" component set (175:21077).
// Covered here: Default (31:13535), Saved (175:21078), and the verified
// landlord row from the Default body. NOT covered: State=Leased
// (176:21949) and State=Property (181:23053) — the backend has no leased
// status (Listing.Status is draft/pending_review/published/rejected/
// archived), so those two variants have nothing to render from yet.
// Open decision with design: what maps to them before building stories.
//
// NOTE: the SaveToggle heart is visual-only in isolation — clicking it
// calls the real save endpoint via authedFetch, which has no session
// inside Storybook and fails gracefully into the toggle's error text.

const baseListing: PublicListing = {
  id: 42,
  title: "2-bed in Osu",
  city: "Accra",
  neighborhood: "Osu",
  bedrooms: 2,
  bathrooms: 1,
  price_monthly: "2,500",
  price_one_time: null,
  listing_type: "rent",
  advance_rent_period: "1_year",
  location: null,
  photos: [],
  is_saved: false,
  is_staff_verified: false,
  landlord_public: null,
  amenities_detail: [],
};

const meta: Meta<typeof DiscoveryListingCard> = {
  title: "Discovery/ListingCard",
  component: DiscoveryListingCard,
  tags: ["ai-generated"], // vitest green 2026-09-22
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
  args: {
    isHovered: false,
    onHover: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof DiscoveryListingCard>;

export const Default: Story = {
  args: {
    listing: { ...baseListing },
    showSaveToggle: false,
  },
};

export const Saved: Story = {
  args: {
    listing: { ...baseListing, is_saved: true },
    showSaveToggle: true,
  },
};

export const Verified: Story = {
  args: {
    listing: {
      ...baseListing,
      is_saved: true,
      is_staff_verified: true,
      landlord_public: { full_name: "Ama Serwaa", id_verified: true },
      amenities_detail: [
        { id: 1, name: "Pool", slug: "pool" },
        { id: 2, name: "Backup power", slug: "backup-power" },
      ],
    },
    showSaveToggle: true,
  },
};

// The single CssCheck for the project: the "1yr advance" pill uses
// text-[10px] — fails if Tailwind / globals.css did not load in preview.
export const CssCheck: Story = {
  args: {
    listing: { ...baseListing },
    showSaveToggle: false,
  },
  play: async ({ canvas }) => {
    const pill = canvas.getByText("1yr advance");
    await expect(getComputedStyle(pill).fontSize).toBe("10px");
  },
};
