import type { Preview } from '@storybook/nextjs-vite'

// Same Tailwind v4 entry the app uses — stories render with real tokens.
import '../src/app/globals.css';
// Same next/font loaders the app uses (Inter, Plus Jakarta Sans, Clash
// Display). app/layout.tsx puts their CSS variables on <html>; the
// decorator below does the same for the story iframe, so `font-sans`,
// `font-display` and `font-label` resolve to the real faces here too.
import { fontVariables } from '../src/lib/fonts';

const preview: Preview = {
  decorators: [
    (Story) => {
      if (typeof document !== 'undefined') {
        document.documentElement.classList.add(...fontVariables.split(' '));
      }
      return <Story />;
    },
  ],
  parameters: {
    controls: {
      matchers: {
       color: /(background|color)$/i,
       date: /Date$/i,
      },
    },

    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: 'todo'
    }
  },
};

export default preview;
