"use client";

import { BILLING_PRODUCTS } from "@quieter/billing/plans";
import { useState } from "react";

import { AiSection } from "./ai-section";
import { ConnectSection } from "./connect-section";
import { HomeAtmosphericBackground } from "./lazy-webgl-backgrounds";
import { Reveal } from "./reveal";
import { WaitlistForm } from "./waitlist-form";

const experience = [
  {
    body: "Save a reply. Use it again.",
    graphic: (
      <div className="w-full max-w-80 space-y-4 rounded-xl bg-bg-raised/50 p-6 text-left text-sm text-muted-fg">
        <p>Thanks for reaching out</p>
        <p>Following up on our conversation</p>
        <p>Getting started</p>
      </div>
    ),
    id: "home-templates-title",
    title: "Templates",
  },
  {
    body: "Keep moving without the mouse.",
    graphic: (
      <div className="flex gap-3 text-sm text-fg">
        <span className="flex h-14 w-20 items-center justify-center rounded-lg bg-bg-raised/70">
          Ctrl
        </span>
        <span className="flex size-14 items-center justify-center rounded-lg bg-bg-raised/70">
          K
        </span>
      </div>
    ),
    id: "home-shortcuts-title",
    title: "Keyboard shortcuts",
  },
  {
    body: "Work and personal, neatly separate.",
    graphic: (
      <div className="space-y-5 text-sm text-muted-fg">
        <p className="flex items-center gap-4">
          <span className="size-2 rounded-full bg-q-blue" />
          Work
        </p>
        <p className="flex items-center gap-4">
          <span className="size-2 rounded-full bg-q-pink" />
          Personal
        </p>
        <p className="flex items-center gap-4">
          <span className="size-2 rounded-full bg-q-green" />
          Support
        </p>
      </div>
    ),
    id: "home-inboxes-title",
    title: "Multiple inboxes",
  },
  {
    body: "At your desk or on your phone.",
    graphic: (
      <div className="relative h-28 w-52">
        <div className="h-28 w-44 rounded-xl border border-muted-fg/40 bg-bg-raised/30 p-3">
          <div className="h-full w-8 rounded bg-bg-raised/60" />
        </div>
        <div className="absolute right-0 bottom-0 h-20 w-11 rounded-lg border border-muted-fg/40 bg-black p-2">
          <div className="h-1 w-4 rounded bg-muted-fg/40" />
        </div>
      </div>
    ),
    id: "home-screens-title",
    title: "Any screen",
  },
] as const;

const ExperienceSection = () => (
  <>
    {experience.map((item) => (
      <section
        aria-labelledby={item.id}
        className="w-full max-w-xl px-6 text-center"
        key={item.id}
      >
        <Reveal>
          <h2
            className="text-2xl font-normal text-balance text-fg"
            id={item.id}
          >
            {item.title}
          </h2>
          <div aria-hidden className="flex h-56 items-center justify-center">
            {item.graphic}
          </div>
          <p className="text-sm leading-relaxed text-muted-fg">{item.body}</p>
        </Reveal>
      </section>
    ))}
  </>
);
const tiers = [
  {
    credits: null,
    name: "Free",
    price: "Included",
    summary: "Connect your Gmail accounts",
  },
  {
    credits: `$${BILLING_PRODUCTS.managed.creditAmountCents / 100} in credits included.`,
    name: BILLING_PRODUCTS.managed.name,
    price: `$${BILLING_PRODUCTS.managed.monthlyPriceCents / 100}/month`,
    summary: BILLING_PRODUCTS.managed.description,
  },
  {
    credits: `$${BILLING_PRODUCTS.pro.creditAmountCents / 100} in credits included.`,
    name: BILLING_PRODUCTS.pro.name,
    price: `$${BILLING_PRODUCTS.pro.monthlyPriceCents / 100}/month`,
    summary: BILLING_PRODUCTS.pro.description,
  },
] as const;

const Pricing = () => (
  <section
    aria-labelledby="home-pricing-title"
    className="w-full max-w-5xl scroll-mt-24 px-6"
    id="pricing"
  >
    <Reveal className="mb-10 text-center">
      <h2
        className="text-2xl font-normal text-balance text-fg"
        id="home-pricing-title"
      >
        Intuitive pricing
      </h2>
    </Reveal>
    <div className="w-full">
      {tiers.map((tier, index) => (
        <Reveal
          className="border-b border-border/50 last:border-0"
          delay={index * 0.05}
          key={tier.name}
        >
          <div className="grid gap-3 py-6 sm:grid-cols-[1fr_2fr_1fr] sm:items-center sm:gap-6">
            <h3 className="text-sm font-normal text-fg">{tier.name}</h3>
            <div className="text-sm leading-relaxed text-muted-fg">
              <p>{tier.summary}</p>
              {tier.credits === null ? null : (
                <p className="mt-1 text-sm">{tier.credits}</p>
              )}
            </div>
            <p className="text-sm font-normal text-fg tabular-nums sm:text-right">
              {tier.price}
            </p>
          </div>
        </Reveal>
      ))}
    </div>
    <Reveal className="mx-auto mt-5 max-w-xl" delay={0.1}>
      <p className="text-center text-sm leading-relaxed text-pretty text-muted-fg">
        Managed mail starts at $0.20 per 1,000 messages. AI usage is billed at
        model cost plus 15%.
      </p>
    </Reveal>
  </section>
);
const Closing = () => (
  <section className="dark relative z-10 flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-black px-6 pt-32 pb-24 md:pt-36">
    <div className="absolute inset-0">
      <HomeAtmosphericBackground fadeBottom="black" fadeTop="black" />
    </div>

    <div className="relative z-10 flex w-full max-w-220 flex-col items-center text-fg">
      <Reveal
        as="h2"
        className="max-w-205 text-center font-serif text-title-md leading-[1.42] font-normal tracking-[-0.014em] text-balance text-fg sm:text-title-lg md:text-display-md md:leading-[1.48]"
      >
        Email can do more without asking more from you.
      </Reveal>

      <Reveal className="mt-12 flex w-full flex-col items-center" delay={0.1}>
        <WaitlistForm id="closing" />
      </Reveal>
    </div>
  </section>
);

export const HomeSections = () => {
  const [paused, setPaused] = useState(false);
  return (
    <>
      <div className="dark relative bg-black text-fg" data-home-paused={paused}>
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="sticky top-0 h-dvh">
            <HomeAtmosphericBackground
              animate={!paused}
              fadeTop="black"
              fadeBottom="black"
              intensity={0.5}
            />
          </div>
        </div>

        <div className="relative z-10 flex w-full flex-col items-center gap-20 py-20 md:gap-28 md:py-28">
          <ConnectSection paused={paused} onPausedChange={setPaused} />
          <AiSection />
          <ExperienceSection />
          <Pricing />
        </div>
      </div>
      <Closing />
    </>
  );
};
