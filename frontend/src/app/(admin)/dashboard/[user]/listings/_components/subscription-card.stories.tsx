import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import type { LandlordSubscription } from "@/lib/payments";
import { SubscriptionCardView } from "./subscription-card";

// Every state of the landlord's plan card, drawn from the exact
// GET /payments/subscription/ shape (backend payments/views.py
// my_subscription + payments/limits.py usage_for). No Figma frame exists
// for this card; it follows the dashboard's PR #33 design language
// (PaddyBadge, PaddyButton, Clash Display plan name).

const FREE_FRESH: LandlordSubscription = {
  tier: "free",
  status: "inactive",
  current_period_end: null,
  cancel_at_period_end: false,
  paid_access_ends_at: null,
  effective_tier: "free",
  listings_used: 0,
  listing_cap: 3,
  listings_paused: 0,
  listings_draft: 0,
  listings_total: 0,
  listing_total_cap: 10,
};

const AGENT_ACTIVE: LandlordSubscription = {
  id: 1,
  tier: "agent",
  status: "active",
  current_period_end: "2026-10-28T09:00:00Z",
  cancel_at_period_end: false,
  paid_access_ends_at: "2026-10-31T09:00:00Z",
  effective_tier: "agent",
  listings_used: 4,
  listing_cap: 10,
  listings_paused: 0,
  listings_draft: 2,
  listings_total: null,
  listing_total_cap: null,
};

const meta: Meta<typeof SubscriptionCardView> = {
  title: "Dashboard/SubscriptionCard",
  component: SubscriptionCardView,
  tags: ["ai-generated"],
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SubscriptionCardView>;

// A landlord who has never paid.
export const FreeFresh: Story = { args: { subscription: FREE_FRESH } };

// 2 of 3 live — the stepper still offers Submit for review.
export const FreeTwoLive: Story = {
  args: {
    subscription: { ...FREE_FRESH, listings_used: 2, listings_draft: 3, listings_total: 5 },
  },
};

// 3 of 3 live — the stepper swaps Submit for "Upgrade to submit".
export const FreeAtLiveLimit: Story = {
  args: {
    subscription: { ...FREE_FRESH, listings_used: 3, listings_draft: 4, listings_total: 7 },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/limit reached/i)).toBeInTheDocument();
  },
};

// 10 of 10 in total — the stepper blocks create before step 1.
export const FreeAtTotalLimit: Story = {
  args: {
    subscription: { ...FREE_FRESH, listings_used: 3, listings_draft: 7, listings_total: 10 },
  },
};

export const AgentActive: Story = {
  args: { subscription: AGENT_ACTIVE },
  play: async ({ canvas }) => {
    // Already on agent: only the other paid plan is offered.
    await expect(canvas.queryByRole("button", { name: /paddy agent/i })).toBeNull();
    await expect(canvas.getByRole("button", { name: /upgrade to paddy lord/i })).toBeInTheDocument();
  },
};

export const AgentCancelled: Story = {
  args: {
    subscription: {
      ...AGENT_ACTIVE,
      cancel_at_period_end: true,
      paid_access_ends_at: AGENT_ACTIVE.current_period_end,
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/cancelled — your plan ends on/i)).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: /cancel plan/i })).toBeNull();
  },
};

export const AgentPastDue: Story = {
  args: {
    subscription: {
      ...AGENT_ACTIVE,
      status: "past_due",
      paid_access_ends_at: "2026-10-31T09:00:00Z",
    },
  },
};

// The plan ran out: the stored tier still says agent, Free's limits
// apply, and the two newest live listings were paused.
export const AgentLapsedWithPaused: Story = {
  args: {
    subscription: {
      ...FREE_FRESH,
      id: 1,
      tier: "agent",
      status: "past_due",
      current_period_end: "2026-09-20T09:00:00Z",
      listings_used: 3,
      listings_paused: 2,
      listings_draft: 1,
      listings_total: 6,
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Ended")).toBeInTheDocument();
    await expect(canvas.getByText(/2 listings paused/i)).toBeInTheDocument();
  },
};

export const LordActive: Story = {
  args: {
    subscription: {
      ...AGENT_ACTIVE,
      tier: "lord",
      effective_tier: "lord",
      listings_used: 23,
      listing_cap: null,
    },
  },
};

export const UpgradeError: Story = {
  args: {
    subscription: AGENT_ACTIVE,
    actionError: "Your last plan change is still being finalised. Please try again in a few minutes.",
  },
};
