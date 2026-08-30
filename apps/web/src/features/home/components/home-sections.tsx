"use client";

import { BILLING_PRODUCTS } from "@quieter/billing/plans";
import { cn } from "@quieter/ui/cn";

import { AiSection } from "./ai-section";
import { ConnectSection } from "./connect-section";
import { DesignFrame } from "./design-frame";
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
    body: "iOS, Android, Web, Desktop, we gotchu",
    title: "On every platform",
  },
] as const;

const ExperienceSection = () => (
  <>
    <Reveal className="flex flex-col items-center justify-center overflow-hidden p-[40px]">
      <h2 className="text-center font-serif text-[48px] whitespace-nowrap text-fg italic">
        A better email experience
      </h2>
    </Reveal>

    <div className="flex w-[1654px] flex-col items-start gap-[100px] overflow-hidden p-[100px] whitespace-nowrap italic">
      {experience.map((item, index) => (
        <Reveal
          className={cn("flex w-full flex-col overflow-hidden px-[110px]", {
            "items-end": index % 2 !== 0,
            "items-start": index % 2 === 0,
          })}
          delay={0.06}
          key={item.title}
        >
          <h3 className="shrink-0 font-serif text-[40px] text-fg">
            {item.title}
          </h3>
          <p className="shrink-0 font-sans text-[24px] text-muted-fg">
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
    summary: "Infinite Gmail",
  },
  {
    credits: `$${BILLING_PRODUCTS.managed.creditAmountCents / 100} in credits included.`,
    name: BILLING_PRODUCTS.managed.name,
    price: `$${BILLING_PRODUCTS.managed.monthlyPriceCents / 100}/month`,
    summary: "Infinite managed mailboxes, infinite domains.",
  },
  {
    credits: `$${BILLING_PRODUCTS.pro.creditAmountCents / 100} in credits included.`,
    name: BILLING_PRODUCTS.pro.name,
    price: `$${BILLING_PRODUCTS.pro.monthlyPriceCents / 100}/month`,
    summary: "Infinite managed mailboxes, infinite domains, all AI features.",
  },
] as const;

const Pricing = () => (
  <>
    <Reveal
      className="flex flex-col items-center justify-center overflow-hidden p-[40px]"
      id="pricing"
    >
      <h2 className="text-center font-serif text-[48px] whitespace-nowrap text-fg italic">
        Intuitive pricing
      </h2>
    </Reveal>

    <div className="flex w-[1363px] flex-col items-center justify-center overflow-hidden p-[10px]">
      <div className="h-px w-full shrink-0 bg-fg/40" />
      {tiers.map((tier, index) => (
        <Reveal className="w-full" delay={index * 0.07} key={tier.name}>
          <div className="flex h-[159px] w-full items-start overflow-hidden">
            <div className="flex h-full w-[332px] shrink-0 items-center justify-center overflow-hidden px-[166px] py-[46px]">
              <p className="shrink-0 font-serif text-[24px] whitespace-nowrap text-fg italic">
                {tier.name}
              </p>
            </div>
            <div className="flex h-full min-w-px flex-1 items-center justify-center overflow-hidden px-[166px] py-[46px]">
              <p className="shrink-0 text-center font-serif whitespace-nowrap text-fg italic">
                <span className="text-[24px]">{tier.summary}</span>
                {tier.credits === null ? null : (
                  <>
                    <br />
                    <span className="text-[20px]">{tier.credits}</span>
                  </>
                )}
              </p>
            </div>
            <div className="flex h-[159px] w-[332px] shrink-0 items-center justify-center overflow-hidden px-[166px] py-[46px]">
              <p className="shrink-0 font-serif text-[24px] whitespace-nowrap text-fg italic">
                {tier.price}
              </p>
            </div>
          </div>
          <div className="h-px w-full shrink-0 bg-fg/40" />
        </Reveal>
      ))}

      <Reveal className="flex items-start overflow-hidden p-[10px]" delay={0.1}>
        <p className="shrink-0 text-center font-serif text-[20px] whitespace-nowrap text-fg italic">
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

export const HomeSections = () => (
  <>
    <div className="theme-light relative overflow-hidden bg-bg-surface">
      <SoftGradientField />

      <DesignFrame>
        <div className="relative z-10 flex w-full flex-col items-center gap-[112px] py-[200px]">
          <ConnectSection />
          <AiSection />
          <ExperienceSection />
          <Pricing />
        </div>
      </DesignFrame>
    </div>
    <Closing />
  </>
);
