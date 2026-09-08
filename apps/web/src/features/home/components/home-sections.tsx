"use client";

import { BILLING_PRODUCTS } from "@quieter/billing/plans";
import { useState } from "react";

import { AiSection } from "./ai-section";
import { ConnectSection } from "./connect-section";
import { HomeAtmosphericBackground } from "./lazy-webgl-backgrounds";
import { WorkflowPreview } from "./product-previews";
import { Reveal } from "./reveal";
import { WaitlistForm } from "./waitlist-form";

const ExperienceSection = () => (
  <section
    aria-labelledby="home-experience-title"
    className="w-full max-w-6xl px-6"
  >
    <Reveal>
      <h2
        className="text-center text-3xl font-medium tracking-tight text-balance text-fg sm:text-4xl"
        id="home-experience-title"
      >
        Made for the way you work.
      </h2>
      <div aria-hidden className="home-product-stage mt-10">
        <WorkflowPreview />
      </div>
      <div className="mt-8 grid gap-6 text-sm leading-relaxed text-muted-fg sm:grid-cols-3">
        <p>
          <span className="text-fg">Fewer repeated steps.</span>
          <br />
          Templates and intuitive shortcuts.
        </p>
        <p>
          <span className="text-fg">Room for every inbox.</span>
          <br />
          Work and personal, neatly separate.
        </p>
        <p>
          <span className="text-fg">Wherever you are.</span>
          <br />
          On your computer or your phone.
        </p>
      </div>
    </Reveal>
  </section>
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
    className="w-full max-w-6xl scroll-mt-24 px-6"
    id="pricing"
  >
    <Reveal className="mb-10 text-center">
      <h2
        className="text-3xl font-medium tracking-tight text-balance text-fg sm:text-4xl"
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

        <div className="relative z-10 flex w-full flex-col items-center gap-24 py-24 md:gap-36 md:py-36">
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
