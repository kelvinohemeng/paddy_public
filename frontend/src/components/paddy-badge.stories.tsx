import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { X } from "lucide-react";

import {
  PaddyBadge,
  type PaddyBadgeSize,
  type PaddyBadgeState,
} from "./paddy-badge";

// Mirrors Figma Handoff → "Badge" (239:141854): 6 states × 2 sizes ×
// 2 radii × Base / Left Icon / Right Icon. Figma's icon slot shows an
// x-mark; any 15px icon component fits.

const STATES: PaddyBadgeState[] = [
  "neutral",
  "information",
  "feature",
  "success",
  "warning",
  "error",
];
const SIZES: PaddyBadgeSize[] = ["2xs", "xs"];

// Figma's x-mark: 1.5px strokes, round caps.
function XMark({ className }: { className?: string }) {
  return <X className={className} strokeWidth={1.5} />;
}

const meta: Meta<typeof PaddyBadge> = {
  title: "Primitives/Badge",
  component: PaddyBadge,
  tags: ["ai-generated"],
  args: { children: "Badge", state: "neutral", size: "xs", rounded: false },
  argTypes: {
    state: { control: "select", options: STATES },
    size: { control: "inline-radio", options: SIZES },
  },
};

export default meta;
type Story = StoryObj<typeof PaddyBadge>;

export const Playground: Story = {};

// The whole set, laid out like the Figma frame.
export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {STATES.map((state) => (
        <div key={state} className="flex flex-wrap items-center gap-3">
          <span className="w-24 text-xs text-[#71717a]">{state}</span>
          {SIZES.flatMap((size) =>
            [false, true].flatMap((rounded) => [
              <PaddyBadge key={`${size}-${rounded}-b`} state={state} size={size} rounded={rounded}>
                Badge
              </PaddyBadge>,
              <PaddyBadge key={`${size}-${rounded}-l`} state={state} size={size} rounded={rounded} leftIcon={XMark}>
                Badge
              </PaddyBadge>,
              <PaddyBadge key={`${size}-${rounded}-r`} state={state} size={size} rounded={rounded} rightIcon={XMark}>
                Badge
              </PaddyBadge>,
            ]),
          )}
        </div>
      ))}
    </div>
  ),
};

// How the product uses it (Listing Card Leased / Property states).
export const LeaseStatuses: Story = {
  render: () => (
    <div className="flex gap-2">
      <PaddyBadge state="information">Leased</PaddyBadge>
      <PaddyBadge state="success">Active</PaddyBadge>
      <PaddyBadge state="warning">Pending review</PaddyBadge>
      <PaddyBadge state="error">Rejected</PaddyBadge>
      <PaddyBadge state="neutral">Draft</PaddyBadge>
    </div>
  ),
};
