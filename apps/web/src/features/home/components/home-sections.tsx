"use client";

import { BILLING_PRODUCTS } from "@quieter/billing/plans";
import { cn } from "@quieter/ui/cn";
import { useState } from "react";

import { AiSection } from "./ai-section";
import { ConnectSection } from "./connect-section";
import { HomeAtmosphericBackground } from "./lazy-webgl-backgrounds";
import { Reveal } from "./reveal";
import { SoftGradientField } from "./soft-gradient-field";
import { WaitlistForm } from "./waitlist-form";

const experience = [
  {
    body: "Save what you write, so you don't have to repeat it",
    title: "Templates",
  },
  {
    body: "Every page, dialog and feature, just one button-press away",
    title: "Clean UI with intuitive shortcuts",
  },
  {
    body: "One for work, one for personal things, one for support, and as many more as you need",
    title: "As many inboxes as you want",
  },
  {
    body: "Use Quieter in your browser, on your phone or computer",
    title: "Mail wherever you work",
  },
] as const;

const ExperienceSection = () => (
  <>
    <Reveal className="px-6">
      <h2 className="text-center font-serif text-3xl text-balance text-fg italic md:text-5xl">
        A better email experience
      </h2>
    </Reveal>

    <div className="flex w-full max-w-7xl flex-col gap-12 px-6 italic md:gap-24 md:px-12">
      {experience.map((item, index) => (
        <Reveal
          className={cn("flex w-full flex-col gap-3", {
            "items-start": index % 2 === 0,
            "md:items-end md:text-right": index % 2 !== 0,
          })}
          delay={0.06}
          key={item.title}
        >
          <h3 className="font-serif text-2xl text-balance text-fg md:text-4xl">
            {item.title}
          </h3>
          <p className="max-w-3xl font-sans text-base text-pretty text-muted-fg md:text-2xl">
            {item.body}
          </p>
        </Reveal>
      ))}
    </div>
  </>
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
  <>
    <Reveal className="scroll-mt-24 px-6" id="pricing">
      <h2 className="text-center font-serif text-3xl text-balance text-fg italic md:text-5xl">
        Intuitive pricing
      </h2>
    </Reveal>

    <div className="flex w-full max-w-7xl flex-col px-6">
      <div className="h-px w-full shrink-0 bg-fg/40" />
      {tiers.map((tier, index) => (
        <Reveal className="w-full" delay={index * 0.07} key={tier.name}>
          <div className="grid w-full gap-4 py-8 md:grid-cols-[1fr_2fr_1fr] md:items-center md:gap-8 md:py-12">
            <div>
              <h3 className="font-serif text-xl text-fg italic md:text-2xl">
                {tier.name}
              </h3>
            </div>
            <div className="min-w-0">
              <p className="font-serif text-fg italic md:text-center">
                <span className="text-lg md:text-2xl">{tier.summary}</span>
                {tier.credits === null ? null : (
                  <>
                    <br />
                    <span className="text-base md:text-xl">{tier.credits}</span>
                  </>
                )}
              </p>
            </div>
            <div>
              <p className="font-serif text-xl text-fg italic tabular-nums md:text-right md:text-2xl">
                {tier.price}
              </p>
            </div>
          </div>
          <div className="h-px w-full shrink-0 bg-fg/40" />
        </Reveal>
      ))}

      <Reveal className="py-6" delay={0.1}>
        <p className="text-center font-serif text-base text-pretty text-fg italic md:text-xl">
          Managed mail starts at $0.20 per 1,000 messages. AI usage is billed at
          model cost plus 15%.
        </p>
      </Reveal>
    </div>
  </>
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

        <div className="relative z-10 flex w-full flex-col items-center gap-16 py-20 md:gap-28 md:py-40">
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
