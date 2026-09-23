import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PaddyIcon, PADDY_ICON_NAMES } from "./paddy-icons";

// Gallery for the Figma "Paddy Icons" component set (242:35101).
// Render-only — a missing/renamed icon fails visibly (no glyph),
// not silently. See paddy-icons.tsx header for the lucide-react
// substitution note (relay can't export vector path data).

const meta: Meta<typeof PaddyIcon> = {
  title: "Tokens/PaddyIcons",
  component: PaddyIcon,
  tags: ["ai-generated"],
};

export default meta;
type Story = StoryObj<typeof PaddyIcon>;

export const AllIcons: Story = {
  render: () => (
    <div className="grid grid-cols-5 gap-6">
      {PADDY_ICON_NAMES.map((name) => (
        <div key={name} className="flex flex-col items-center gap-2">
          <div className="flex size-10 items-center justify-center rounded-md border">
            <PaddyIcon name={name} />
          </div>
          <p className="text-muted-foreground text-[11px]">{name}</p>
        </div>
      ))}
    </div>
  ),
};
