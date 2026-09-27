import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";
import { ArrowRight, Plus } from "lucide-react";

import {
  PaddyButton,
  type PaddyButtonSize,
  type PaddyButtonStyle,
} from "./paddy-button";

// Mirrors Figma Handoff → "Button" (239:142144): 5 styles × 4 sizes ×
// Default / Hover / Pressed / Focus / Disabled. Hover and Focus are
// real interaction states here (hover the button, or Tab to it).

const STYLES: PaddyButtonStyle[] = [
  "primary",
  "secondary",
  "danger",
  "transparent",
  "transparent-muted",
];
const SIZES: PaddyButtonSize[] = ["sm", "base", "lg", "xl"];

const meta: Meta<typeof PaddyButton> = {
  title: "Primitives/Button",
  component: PaddyButton,
  tags: ["ai-generated"],
  args: { children: "Label", variant: "primary", size: "base" },
  argTypes: {
    variant: { control: "select", options: STYLES },
    size: { control: "select", options: SIZES },
  },
};

export default meta;
type Story = StoryObj<typeof PaddyButton>;

export const Playground: Story = {};

export const Primary: Story = { args: { variant: "primary" } };
export const Secondary: Story = { args: { variant: "secondary" } };
export const Danger: Story = { args: { variant: "danger" } };
export const Transparent: Story = { args: { variant: "transparent" } };
export const TransparentMuted: Story = {
  args: { variant: "transparent-muted" },
};

// The Figma grid: every style at every size, then Loading (Figma's
// "Pressed") and Disabled.
export const AllVariants: Story = {
  render: () => (
    <div className="grid grid-cols-[auto_repeat(6,auto)] items-center gap-x-6 gap-y-4 text-xs text-[#71717a]">
      <span />
      {[...SIZES, "loading", "disabled"].map((col) => (
        <span key={col}>{col}</span>
      ))}
      {STYLES.map((style) => (
        <div key={style} className="contents">
          <span>{style}</span>
          {SIZES.map((size) => (
            <div key={size}>
              <PaddyButton variant={style} size={size}>
                Label
              </PaddyButton>
            </div>
          ))}
          <div>
            <PaddyButton variant={style} isLoading>
              Label
            </PaddyButton>
          </div>
          <div>
            <PaddyButton variant={style} disabled>
              Label
            </PaddyButton>
          </div>
        </div>
      ))}
    </div>
  ),
};

export const WithIcons: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <PaddyButton leftIcon={Plus}>New listing</PaddyButton>
      <PaddyButton variant="secondary" rightIcon={ArrowRight}>
        Continue
      </PaddyButton>
      <PaddyButton variant="transparent" leftIcon={Plus} size="sm">
        Add
      </PaddyButton>
    </div>
  ),
};

// Loading swallows clicks but keeps the button focusable and its width.
export const LoadingIgnoresClicks: Story = {
  args: { isLoading: true, onClick: fn() },
  play: async ({ canvas, userEvent, args }) => {
    const button = canvas.getByRole("button", { name: /label/i });
    await expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

export const ClickFires: Story = {
  args: { onClick: fn() },
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: /label/i }));
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};
