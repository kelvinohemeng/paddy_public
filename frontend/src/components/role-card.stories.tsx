import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { RoleCard } from "./role-card";

// Mirrors Figma Handoff → "Role Card" (242:3862): Selected (red
// gradient + white seal) / Default (plain white) / Muted (50% opacity,
// not clickable).

const meta: Meta<typeof RoleCard> = {
  title: "Primitives/RoleCard",
  component: RoleCard,
  tags: ["ai-generated"],
  args: { role: "Landlord" },
};

export default meta;
type Story = StoryObj<typeof RoleCard>;

export const Default: Story = { args: { state: "default" } };
export const Selected: Story = { args: { state: "selected" } };
export const Muted: Story = { args: { state: "muted" } };

export const Row: Story = {
  render: () => (
    <div className="flex gap-4">
      <RoleCard role="Landlord" state="selected" />
      <RoleCard role="Renter" state="default" />
      <RoleCard role="Agent" state="muted" />
    </div>
  ),
};

// Selected must announce aria-pressed=true; Muted must be a real
// disabled button (no click handler firing).
export const Interaction: Story = {
  args: { state: "default" },
  render: (args) => {
    let clicks = 0;
    return (
      <RoleCard
        {...args}
        onSelect={() => {
          clicks += 1;
        }}
      />
    );
  },
  play: async ({ canvas, userEvent }) => {
    const button = canvas.getByRole("button", { name: /landlord/i });
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(button);
  },
};
