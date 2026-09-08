"use client";

import { BILLING_PRODUCTS } from "@quieter/billing/plans";
import { useState } from "react";

import { AiSection } from "./ai-section";
import { ConnectSection } from "./connect-section";
import { HomeAtmosphericBackground } from "./lazy-webgl-backgrounds";
import { Reveal } from "./reveal";
import { SoftGradientField } from "./soft-gradient-field";
import { WaitlistForm } from "./waitlist-form";

const experience = [
  {
    body: "Keep your best replies close. Save a template and skip writing the same email twice.",
    title: "Templates",
  },
  {
    body: "Move between messages, start a draft, and find what you need from your keyboard.",
    title: "A shortcut to the next thing",
  },
  {
    body: "Work, personal, and support. Keep each inbox separate and switch without the tab shuffle.",
    title: "Room for every inbox",
  },
  {
    body: "A workspace that fits your screen, from your desk to your phone.",
    title: "Mail wherever you work",
  },
] as const;

const ExperienceSection = () => (
  <section
    aria-labelledby="home-experience-title"
    className="grid w-full max-w-6xl gap-10 px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16"
  >
    <Reveal className="max-w-sm">
      <p className="mb-3 text-xs font-medium tracking-widest text-muted-fg uppercase">
        The everyday details
      </p>
      <h2
        className="font-serif text-2xl leading-snug tracking-tight text-balance text-fg sm:text-3xl"
        id="home-experience-title"
      >
        A better email experience
      </h2>
      <p className="mt-4 text-sm leading-relaxed text-pretty text-muted-fg">
        Small things you notice every day. Fewer repeated steps, less switching
        around, and a little more room to focus.
      </p>
      <div
        aria-hidden
        className="mt-8 inline-flex items-center gap-2 rounded-xl border border-border/60 bg-card/70 px-4 py-3 text-xs text-muted-fg shadow-elevation-sm"
      >
        <span className="mr-4">Find anything</span>
        <span className="flex size-7 items-center justify-center rounded-md border border-border/60 bg-bg-surface font-mono text-fg shadow-xs">
          Ctrl
        </span>
        <span className="flex size-7 items-center justify-center rounded-md border border-border/60 bg-bg-surface font-mono text-fg shadow-xs">
          K
        </span>
      </div>
    </Reveal>

    <div className="grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2">
      {experience.map((item, index) => (
        <Reveal
          className="border-t border-border/70 pt-5"
          delay={index * 0.04}
          key={item.title}
        >
          <span
            aria-hidden
            className="mb-4 block font-mono text-[10px] text-muted-fg"
          >
            0{index + 1}
          </span>
          <h3 className="text-sm font-medium text-balance text-fg">
            {item.title}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-pretty text-muted-fg">
            {item.body}
          </p>
        </Reveal>
      ))}
    </div>
  </section>
);

const tiers = [
  {
    credits: null,
    name: "Free and always included",
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
    className="w-full max-w-6xl scroll-mt-24 px-6"
    id="pricing"
  >
    <Reveal className="mb-10 text-center">
      <h2
        className="font-serif text-2xl leading-snug tracking-tight text-balance text-fg sm:text-3xl"
        id="home-pricing-title"
      >
        Intuitive pricing
      </h2>
    </Reveal>
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-elevation-sm">
      {tiers.map((tier, index) => (
        <Reveal
          className="border-b border-border/50 last:border-0"
          delay={index * 0.05}
          key={tier.name}
        >
          <div className="grid gap-3 px-6 py-6 sm:grid-cols-[1fr_2fr_1fr] sm:items-center sm:gap-6 sm:px-8">
            <h3 className="text-sm font-medium text-fg">{tier.name}</h3>
            <div className="text-sm leading-relaxed text-muted-fg">
              <p>{tier.summary}</p>
              {tier.credits === null ? null : (
                <p className="mt-1 text-xs">{tier.credits}</p>
              )}
            </div>
            <p className="text-base font-medium text-fg tabular-nums sm:text-right">
              {tier.price}
            </p>
          </div>
        </Reveal>
      ))}
    </div>
    <Reveal className="mx-auto mt-5 max-w-xl" delay={0.1}>
      <p className="text-center text-xs leading-relaxed text-pretty text-muted-fg">
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
      <div
        className="theme-light relative overflow-hidden bg-bg-surface"
        data-home-paused={paused}
      >
        <SoftGradientField />

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
