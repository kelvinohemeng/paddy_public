import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import localFont from "next/font/local";

// paddy's three typefaces, read from the Figma file (Design + Handoff
// pages, 2026-09-27):
// - Inter             → body / UI text (buttons, badges, nav, forms)
// - Clash Display     → display + headings (card titles, prices, role
//                       names, search-pill field labels)
// - Plus Jakarta Sans → small meta labels (card subtitles, detail
//                       pills, "You are", landlord line)
//
// Each loader exposes a CSS variable; globals.css maps them onto the
// Tailwind `font-sans` / `font-display` / `font-label` utilities. The
// variables are attached to <html> in app/layout.tsx and to the story
// wrapper in .storybook/preview.tsx, so both render the real fonts.

export const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

// Clash Display isn't on Google Fonts — it's an Indian Type Foundry
// face from Fontshare, free for commercial use under the ITF Free Font
// License (copy in src/fonts/ClashDisplay-LICENSE.txt). Self-hosted so
// there's no third-party font request at runtime. Only the two weights
// the designs use are shipped.
export const clashDisplay = localFont({
  src: [
    { path: "../fonts/ClashDisplay-Medium.woff2", weight: "500", style: "normal" },
    { path: "../fonts/ClashDisplay-Semibold.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-clash",
  display: "swap",
});

// Space-separated class list that declares all three variables.
export const fontVariables = [
  inter.variable,
  plusJakartaSans.variable,
  clashDisplay.variable,
].join(" ");
