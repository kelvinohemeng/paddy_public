import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  ArrowRight,
  CalendarClock,
  Camera,
  MapPin,
  ShieldCheck,
  Zap,
} from "lucide-react";

import { DHSearchPill } from "@/app/(public)/_components/dh-search-pill";
import { DiscoveryHeader } from "@/app/(public)/_components/discovery-header";
import { DISCOVERY_PATH } from "@/app/(public)/_components/discovery-path";
import { Logo } from "@/components/logo";
import { paddyButtonClassName } from "@/components/paddy-button";
import { PaddyEyes } from "@/components/paddy-eyes";
import { VerifiedSealIcon } from "@/components/paddy-icons";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { SubscriptionTier } from "@/lib/payments";
import { TIER_META } from "@/lib/plans";
import { cn } from "@/lib/utils";

// Marketing landing page at `/`, for renters and landlords. No Figma
// frame exists; it's built from the brand tokens and components.
//
// Static on purpose: no backend fetch. On Render's free plan the backend
// sleeps, and a cold fetch would hold this page for about a minute.
// WakeBackend (root layout) starts waking it while the visitor reads, so
// /homes is ready by the time they click through.
//
// Copy rules (AGENTS.md): lowercase "paddy", no em dashes, and nothing
// that implies brokerage or price negotiation (paddy is an information
// platform, outside the Real Estate Agency Act). The unlock fee has no
// number here: it's set by LISTING_UNLOCK_PRICE_PESEWAS on the backend,
// so a figure on this page could drift.

export const metadata: Metadata = {
  title: "paddy | Verified rentals in Accra and Kumasi",
  description:
    "Every home on paddy is visited by our team before it goes live. Browse free, see the advance upfront, and deal with the landlord directly.",
  openGraph: {
    title: "paddy | Verified rentals in Accra and Kumasi",
    description:
      "Every home on paddy is visited by our team before it goes live. Browse free, see the advance upfront, and deal with the landlord directly.",
    siteName: "paddy",
    type: "website",
  },
};

const SIGN_UP_PATH = "/register";

const PROBLEMS = [
  {
    problem: "Homes that aren't there",
    detail:
      "Fake listings, and 'agents' who disappear once you've paid a viewing fee.",
    answer: "someone from our team visits every home before it goes live.",
    icon: ShieldCheck,
  },
  {
    problem: "Photos that flatter",
    detail:
      "Old pictures and wide-angle tricks that look nothing like the real place.",
    answer: "photos are checked against the home on that visit.",
    icon: Camera,
  },
  {
    problem: "Two years upfront",
    detail:
      "Advance demands you only hear about once you're standing in the room.",
    answer: "every home shows its advance, 6 months or 1 year, from the start.",
    icon: CalendarClock,
  },
];

const RENTER_STEPS = [
  {
    title: "Search for free",
    detail:
      "Browse verified homes by area, budget and advance period. You don't need an account to look.",
  },
  {
    title: "Unlock the direct line",
    detail:
      "Found the one? Pay a small one-time fee to see the exact address and the landlord's phone number.",
  },
  {
    title: "Deal with the landlord",
    detail:
      "Arrange a visit and pay rent straight to the landlord. paddy never holds your money or takes a cut.",
  },
];

const LANDLORD_STEPS = [
  {
    title: "List your home",
    detail:
      "Create a free account and add your home: photos, rent, advance period and amenities.",
  },
  {
    title: "We visit and verify",
    detail:
      "Someone from the paddy team visits to check the home matches your listing.",
  },
  {
    title: "Renters reach you directly",
    detail:
      "Once approved, your home goes live. Renters who unlock it call you, not an agent.",
  },
];

const CHECKS = [
  {
    title: "It's real, and where it says",
    detail: "The home exists, is available, and sits in the area it's listed in.",
    icon: MapPin,
  },
  {
    title: "The photos match",
    detail: "What you see online is what you'll find at the door.",
    icon: Camera,
  },
  {
    title: "The advance, upfront",
    detail: "6 months or 1 year, shown on the listing and searchable.",
    icon: CalendarClock,
  },
  {
    title: "Water, power and security",
    detail:
      "Water storage, backup power and whether it's walled or gated, all noted on the listing.",
    icon: Zap,
  },
];

const PLAN_ORDER: SubscriptionTier[] = ["free", "agent", "lord"];
const PLAN_BLURB: Record<SubscriptionTier, string> = {
  free: "For a landlord with a home or two.",
  agent: "For landlords and agents managing several homes.",
  lord: "For owners with a large portfolio.",
};

const FAQS = [
  {
    q: "Is paddy a rental agent?",
    a: "No. paddy is a listings platform. We verify homes and put you in touch with the landlord, but we don't negotiate prices, collect rent or charge commission.",
  },
  {
    q: "What does it cost to use paddy?",
    a: "Browsing is free. To see a home's exact address and the landlord's number, you pay a small one-time fee for that home. Rent and deposit go straight to the landlord.",
  },
  {
    q: "How do you verify a home?",
    a: "Before a home goes live, someone from our team visits it. They check it exists, that it matches its photos and description, and note details like the advance, water storage and backup power.",
  },
  {
    q: "Why is the location on the map approximate?",
    a: "Until you unlock a home, the map shows its area to within about half a kilometre. That protects landlords from unannounced visits. Unlocking shows the exact address.",
  },
  {
    q: "Where is paddy available?",
    a: "Accra and Kumasi for now.",
  },
  {
    q: "How do I pay?",
    a: "Payments go through Paystack, so you can pay with mobile money or a card.",
  },
];

const CONTAINER = "mx-auto w-full max-w-6xl px-4 md:px-6";
const SECTION_Y = "py-16 md:py-24";
const LINK_UNDERLINE =
  "text-foreground font-medium underline underline-offset-4 hover:decoration-2";

export default function LandingPage() {
  return (
    <>
      <header className={cn(CONTAINER, "py-3 md:py-4")}>
        <DiscoveryHeader />
      </header>

      <main>
        <Hero />
        <Problems />
        <HowItWorks />
        <Checks />
        <Plans />
        <Faq />
        <FinalCta />
      </main>

      <Footer />
    </>
  );
}

function Hero() {
  return (
    <section className="px-2 md:px-4">
      <div className="mx-auto max-w-7xl rounded-[2rem] bg-[url('/brand/sign-gradient.jpg')] bg-cover bg-center px-4 pt-10 pb-14 text-center md:px-8 md:pt-16 md:pb-20">
        <PaddyEyes
          size={112}
          curve={0}
          eyeSize={0.5}
          roam={0.5}
          className="mx-auto"
        />
        <p className="font-label text-paddy-green-700 mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold">
          <VerifiedSealIcon className="size-3.5" />
          Verified rentals in Accra and Kumasi
        </p>
        <h1 className="font-display mx-auto mt-5 max-w-4xl text-[2.75rem] leading-[1.02] font-semibold tracking-[-0.03em] text-balance sm:text-6xl lg:text-7xl">
          Every home, checked in person.
        </h1>
        <p className="text-subtle-foreground mx-auto mt-5 max-w-2xl text-base text-pretty sm:text-lg">
          Our team visits every home on paddy before it goes live. So the
          photos are real, the advance is stated upfront, and you deal with
          the landlord directly.
        </p>

        {/* Its own boundary: the pill reads useSearchParams, and without
            one the root layout's Suspense would client-render the whole
            page, losing the server HTML this page is for. */}
        <Suspense fallback={<div className="mt-10 h-[116px]" />}>
          <DHSearchPill className="mt-10 text-left" />
        </Suspense>

        <div className="mt-8 flex flex-col items-center gap-4">
          <Link
            href={DISCOVERY_PATH}
            className={paddyButtonClassName({ size: "xl" })}
          >
            Browse all homes
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          <p className="text-subtle-foreground flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
            <span>
              Have a home to rent out?{" "}
              <Link href={SIGN_UP_PATH} className={LINK_UNDERLINE}>
                List it on paddy
              </Link>
            </span>
            <span>
              Just looking around?{" "}
              <Link href="/login" className={LINK_UNDERLINE}>
                Try a demo account
              </Link>
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="font-label text-paddy-red-600 text-sm font-semibold">
        {eyebrow}
      </p>
      <h2 className="font-display mt-2 text-3xl leading-tight font-semibold tracking-[-0.03em] text-balance md:text-5xl">
        {title}
      </h2>
      {description && (
        <p className="text-muted-foreground mt-4 text-base text-pretty md:text-lg">
          {description}
        </p>
      )}
    </div>
  );
}

function Problems() {
  return (
    <section className={cn(CONTAINER, SECTION_Y)}>
      <SectionHeading
        eyebrow="Why paddy"
        title="Renting shouldn't be a gamble."
        description="Fake listings, flattering photos and surprise advance demands make house hunting stressful. paddy is built to take them out of the picture."
      />
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {PROBLEMS.map(({ problem, detail, answer, icon: Icon }) => (
          <article
            key={problem}
            className="bg-card flex flex-col rounded-2xl border p-6"
          >
            <p className="font-label text-paddy-red-600 text-xs font-semibold">
              The problem
            </p>
            <h3 className="font-display mt-2 text-xl font-semibold tracking-[-0.02em]">
              {problem}
            </h3>
            <p className="text-muted-foreground mt-2 mb-6 text-sm">{detail}</p>
            <div className="mt-auto flex gap-3 border-t pt-5">
              <Icon
                className="text-paddy-green-600 mt-0.5 size-5 shrink-0"
                aria-hidden
              />
              <p className="text-sm">
                <span className="font-semibold">On paddy, </span>
                {answer}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-muted/60 scroll-mt-12 border-y">
      <div className={cn(CONTAINER, SECTION_Y)}>
        <SectionHeading
          eyebrow="How it works"
          title="Simple for renters and landlords."
        />
        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          <Track
            title="For renters"
            steps={RENTER_STEPS}
            href={DISCOVERY_PATH}
            cta="Browse homes"
          />
          <Track
            title="For landlords"
            steps={LANDLORD_STEPS}
            href={SIGN_UP_PATH}
            cta="List your property"
          />
        </div>
      </div>
    </section>
  );
}

function Track({
  title,
  steps,
  href,
  cta,
}: {
  title: string;
  steps: { title: string; detail: string }[];
  href: string;
  cta: string;
}) {
  return (
    <div className="bg-card flex flex-col rounded-3xl border p-6 md:p-8">
      <h3 className="font-display text-2xl font-semibold tracking-[-0.02em]">
        {title}
      </h3>
      <ol className="mt-6 flex flex-col gap-6">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-4">
            <span
              aria-hidden
              className="font-display bg-paddy-red-50 text-paddy-red-700 flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
            >
              {i + 1}
            </span>
            <div>
              <p className="font-semibold">{step.title}</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {step.detail}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <Link
        href={href}
        className={paddyButtonClassName({
          variant: "secondary",
          size: "lg",
          className: "mt-8 self-start",
        })}
      >
        {cta}
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </div>
  );
}

function Checks() {
  return (
    <section className="bg-paddy-gray-1 text-white">
      <div
        className={cn(
          CONTAINER,
          SECTION_Y,
          "grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center",
        )}
      >
        <div className="max-w-xl">
          <p className="font-label text-paddy-yellow-400 text-sm font-semibold">
            What verified means
          </p>
          <h2 className="font-display mt-2 text-3xl leading-tight font-semibold tracking-[-0.03em] text-balance md:text-5xl">
            Checked on the ground, not just online.
          </h2>
          <p className="mt-4 text-base text-pretty text-white/70 md:text-lg">
            A home only goes live after our team has been there. Here&apos;s
            what that visit covers.
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {CHECKS.map(({ title, detail, icon: Icon }) => (
            <li
              key={title}
              className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10"
            >
              <Icon className="text-paddy-yellow-400 size-5" aria-hidden />
              <p className="font-display mt-3 text-lg font-semibold tracking-[-0.02em]">
                {title}
              </p>
              <p className="mt-1 text-sm text-white/70">{detail}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Plans() {
  return (
    <section id="plans" className={cn(CONTAINER, SECTION_Y, "scroll-mt-12")}>
      <SectionHeading
        eyebrow="For landlords"
        title="Plans that grow with you."
        description="Start free with up to 3 homes. Every home is verified before it goes live, whichever plan you're on, and renters always browse for free."
      />
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {PLAN_ORDER.map((tier) => {
          const { label, cap, priceGhs } = TIER_META[tier];
          return (
            <div
              key={tier}
              className="bg-card flex flex-col rounded-3xl border p-6 md:p-8"
            >
              <h3 className="font-display text-xl font-semibold tracking-[-0.02em]">
                {label}
              </h3>
              {/* Two lines tall, so the prices line up across cards. */}
              <p className="text-muted-foreground mt-1 min-h-10 text-sm">
                {PLAN_BLURB[tier]}
              </p>
              <p className="mt-6 flex items-baseline gap-1.5">
                <span className="font-display text-4xl font-semibold tracking-[-0.03em]">
                  GHS {(priceGhs ?? 0).toLocaleString("en-GH")}
                </span>
                <span className="text-muted-foreground text-sm">/month</span>
              </p>
              <p className="mt-4 flex items-center gap-2 text-sm">
                <VerifiedSealIcon className="text-paddy-green-600 size-4" />
                {cap === null
                  ? "Unlimited homes live at a time"
                  : `Up to ${cap} homes live at a time`}
              </p>
              <Link
                href={SIGN_UP_PATH}
                className={paddyButtonClassName({
                  variant: tier === "free" ? "primary" : "secondary",
                  size: "lg",
                  className: "mt-8",
                })}
              >
                {tier === "free" ? "Start free" : `Get ${label}`}
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" className="bg-muted/60 scroll-mt-12 border-t">
      <div
        className={cn(
          CONTAINER,
          SECTION_Y,
          "grid gap-10 lg:grid-cols-[0.8fr_1.2fr]",
        )}
      >
        <SectionHeading
          eyebrow="Questions"
          title="Good to know."
          description="The short answers to what people ask us most."
        />
        <Accordion
          type="single"
          collapsible
          className="bg-card rounded-2xl border px-5 md:px-6"
        >
          {FAQS.map(({ q, a }) => (
            <AccordionItem key={q} value={q}>
              <AccordionTrigger className="font-display py-5 text-base font-semibold tracking-[-0.01em]">
                {q}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground pb-5 text-sm">
                {a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className={cn(CONTAINER, SECTION_Y)}>
      <div className="bg-brand-gradient rounded-3xl px-6 py-14 text-center text-white md:px-12 md:py-20">
        <h2 className="font-display mx-auto max-w-2xl text-4xl leading-tight font-semibold tracking-[-0.03em] text-balance md:text-5xl">
          Your next home is already verified.
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-base text-white/80 md:text-lg">
          Search homes in Accra and Kumasi, or list yours for free.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href={DISCOVERY_PATH}
            className={paddyButtonClassName({ variant: "secondary", size: "xl" })}
          >
            Browse homes
          </Link>
          {/* Not a PaddyButton style: none of them is drawn for a red
              background (Transparent turns white on focus). */}
          <Link
            href={SIGN_UP_PATH}
            className="inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium text-white ring-1 ring-white/50 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
          >
            List your property
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t">
      <div
        className={cn(
          CONTAINER,
          "flex flex-col gap-8 py-10 md:flex-row md:items-start md:justify-between",
        )}
      >
        <div className="max-w-xs">
          <Logo />
          <p className="text-muted-foreground mt-3 text-sm">
            Verified long-term rentals in Accra and Kumasi.
          </p>
        </div>
        <nav
          aria-label="Footer"
          className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm"
        >
          <Link href={DISCOVERY_PATH} className="hover:underline">
            Browse homes
          </Link>
          <Link href="#how-it-works" className="hover:underline">
            How it works
          </Link>
          <Link href={SIGN_UP_PATH} className="hover:underline">
            List your property
          </Link>
          <Link href="#plans" className="hover:underline">
            Landlord plans
          </Link>
          <Link href="/login" className="hover:underline">
            Sign in
          </Link>
          <Link href="#faq" className="hover:underline">
            FAQ
          </Link>
        </nav>
      </div>
      <div
        className={cn(
          CONTAINER,
          "text-muted-foreground flex flex-col gap-1 pb-8 text-xs sm:flex-row sm:justify-between",
        )}
      >
        <p>&copy; {new Date().getFullYear()} paddy</p>
        <p>paddy is a listings platform, not a real estate agent.</p>
      </div>
    </footer>
  );
}
