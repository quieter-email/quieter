"use client";

import { cn } from "@quieter/ui/cn";
import { Reveal } from "./landing-shared";
import { WaitlistForm } from "./waitlist-form";

const plans = [
  {
    features: [
      "Connect your Gmail accounts",
      "Keyboard-first triage",
      "Bring your own AI key",
      "Teams and organizations",
    ],
    highlight: false,
    name: "Free",
    price: "$0",
    tagline: "Everything you need to move your everyday mail in.",
  },
  {
    features: [
      "Everything in Free",
      "Mailboxes on your own domain",
      "Shared team workflows",
      "Send API for your product",
      "$10 monthly usage included",
    ],
    highlight: true,
    name: "Managed",
    price: "$15",
    tagline: "Run real mailboxes on domains you own.",
  },
  {
    features: [
      "Everything in Managed",
      "Instant mailbox updates",
      "AI for every member",
      "Automatic labels and useful details",
      "$20 monthly usage included",
    ],
    highlight: false,
    name: "Pro",
    price: "$25",
    tagline: "The full stack, with intelligence built in.",
  },
] as const;

export const LandingPricingSection = () => (
  <section className="scroll-mt-14 px-5 py-28 md:px-8 md:py-40" id="pricing">
    <div className="mx-auto w-full max-w-6xl">
      <div className="grid gap-8 md:grid-cols-2 md:gap-16">
        <Reveal>
          <h2 className="max-w-md text-[1.9rem] leading-[1.12] font-normal tracking-tight text-foreground md:text-[2.35rem]">
            Simple pricing,
            <br />
            per team
          </h2>
        </Reveal>
        <Reveal className="md:pt-2" delay={0.08}>
          <p className="max-w-md text-[15px]/6.5 text-muted-foreground">
            Plans are billed per organization, in US dollars, monthly. Gmail and your own AI key
            stay free forever.
          </p>
          <p className="mt-6 font-mono text-xs text-muted-foreground/60">
            <span className="text-muted-foreground/40">5.0</span>
            <span className="ml-3">Pricing</span>
          </p>
        </Reveal>
      </div>

      <div className="mt-16 grid gap-12 md:mt-24 md:grid-cols-3 md:gap-10">
        {plans.map((plan, index) => (
          <Reveal delay={index * 0.08} key={plan.name}>
            <div className={cn("h-px w-full", plan.highlight ? "bg-white/25" : "bg-white/10")} />
            <div className="mt-6 flex items-baseline justify-between">
              <h3 className="text-base font-normal tracking-tight text-foreground">{plan.name}</h3>
              <p className="text-2xl font-light text-foreground">
                {plan.price}
                <span className="ml-1 text-xs text-muted-foreground/60">/month</span>
              </p>
            </div>
            <p className="mt-2.5 max-w-xs text-sm/6 text-muted-foreground">{plan.tagline}</p>
            <ul className="mt-6 space-y-2.5">
              {plan.features.map((feature) => (
                <li
                  className="flex items-start gap-2.5 text-[13px]/5.5 text-muted-foreground/85"
                  key={feature}
                >
                  <span
                    aria-hidden
                    className="mt-2 size-0.75 shrink-0 rounded-full bg-muted-foreground/50"
                  />
                  {feature}
                </li>
              ))}
            </ul>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);

export const LandingClosingSection = () => (
  <section className="relative overflow-hidden px-5 pt-32 md:px-8 md:pt-44">
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-112 bg-[radial-gradient(ellipse_70%_100%_at_50%_100%,oklch(0.5_0.04_290/0.14),transparent_70%)]"
    />
    <div className="relative mx-auto flex w-full max-w-2xl flex-col items-center text-center">
      <Reveal>
        <h2 className="text-4xl leading-[1.06] font-light tracking-tight text-balance text-foreground md:text-5xl">
          Email can be quiet.
        </h2>
        <p className="mx-auto mt-5 max-w-md text-[15px]/6.5 text-muted-foreground">
          Join the waitlist and be there when Quieter opens.
        </p>
      </Reveal>
      <Reveal className="mt-9 w-full max-w-sm" delay={0.1}>
        <WaitlistForm />
      </Reveal>
    </div>
    <div
      aria-hidden
      className="pointer-events-none relative mt-20 mask-[linear-gradient(to_bottom,black,transparent_94%)] select-none md:mt-28"
    >
      <svg className="block w-full" viewBox="0 0 1000 150">
        <defs>
          <linearGradient id="landing-wordmark-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="oklch(0.165 0.002 264)" />
            <stop offset="1" stopColor="oklch(0.145 0 264)" />
          </linearGradient>
        </defs>
        <text
          className="font-sans font-light tracking-tight"
          fill="url(#landing-wordmark-fill)"
          fontSize="230"
          paintOrder="stroke fill"
          stroke="oklch(1 0 0 / 0.11)"
          strokeWidth="1"
          textAnchor="middle"
          x="500"
          y="180"
        >
          quieter
        </text>
      </svg>
    </div>
  </section>
);
