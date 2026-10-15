import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { DemoBanner } from "./demo-banner";

// The permanent demo notice from app/layout.tsx. One line from md up,
// two on a 375px phone.

const meta: Meta<typeof DemoBanner> = {
  title: "Shell/DemoBanner",
  component: DemoBanner,
  tags: ["ai-generated"],
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof DemoBanner>;

export const Desktop: Story = {};

export const Phone: Story = {
  decorators: [
    (Story) => (
      <div className="w-[375px]">
        <Story />
      </div>
    ),
  ],
};
