import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { PaddyLabel, type PaddyLabelType } from "./paddy-label";

// Mirrors Figma components page → "Label" (289:168764): Type Plus /
// Subtle × Show Optional × Show Tooltip. One story per combination, then
// the whole set in the Figma frame's layout.

const TYPES: PaddyLabelType[] = ["plus", "subtle"];

const meta: Meta<typeof PaddyLabel> = {
  title: "Primitives/Label",
  component: PaddyLabel,
  tags: ["ai-generated"],
  args: { children: "Label", type: "subtle" },
  argTypes: {
    type: { control: "inline-radio", options: TYPES },
  },
};

export default meta;
type Story = StoryObj<typeof PaddyLabel>;

export const Plus: Story = { args: { type: "plus" } };
export const Subtle: Story = { args: { type: "subtle" } };

export const PlusOptional: Story = { args: { type: "plus", optional: true } };
export const SubtleOptional: Story = {
  args: { type: "subtle", optional: true },
};

export const PlusTooltip: Story = {
  args: { type: "plus", tooltip: "Extra help for this field." },
};
export const SubtleTooltip: Story = {
  args: { type: "subtle", tooltip: "Extra help for this field." },
};

export const PlusOptionalTooltip: Story = {
  args: { type: "plus", optional: true, tooltip: "Extra help for this field." },
};
export const SubtleOptionalTooltip: Story = {
  args: {
    type: "subtle",
    optional: true,
    tooltip: "Extra help for this field.",
  },
};

// The whole set, one row per Type.
export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {TYPES.map((type) => (
        <div key={type} className="flex flex-wrap items-center gap-8">
          <PaddyLabel type={type}>Label</PaddyLabel>
          <PaddyLabel type={type} optional>
            Label
          </PaddyLabel>
          <PaddyLabel type={type} tooltip="Extra help">
            Label
          </PaddyLabel>
          <PaddyLabel type={type} optional tooltip="Extra help">
            Label
          </PaddyLabel>
        </div>
      ))}
    </div>
  ),
};

// How the listing form uses it: a real <label> pointing at its input,
// so clicking the text focuses the field and the input's accessible name
// includes "(Optional)".
export const WithInput: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-2.5">
      <PaddyLabel htmlFor="tour-url" optional>
        360° tour URL
      </PaddyLabel>
      <input
        id="tour-url"
        className="border-field-border placeholder:text-field-placeholder h-14 rounded-lg border px-4 text-base"
        placeholder="https://…"
      />
    </div>
  ),
  play: async ({ canvas }) => {
    const input = canvas.getByRole("textbox", { name: /360° tour url \(optional\)/i });
    await expect(input).toBeInTheDocument();
  },
};
