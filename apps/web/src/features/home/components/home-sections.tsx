"use client";

import { BILLING_PRODUCTS } from "@quieter/billing/plans";
import { cn } from "@quieter/ui/cn";
import { HomeAtmosphericBackground, HomeWorkspaceDitherBackground } from "./lazy-webgl-backgrounds";
import { Reveal } from "./reveal";
import { WaitlistForm } from "./waitlist-form";

type Feature = {
  body: string;
  id: string;
  image: string;
  /** Alternates the composition so the page reads as a zigzag, not a stack. */
  imageFirst: boolean;
  title: string;
};

const features: Feature[] = [
  {
    body: "Two-way sync with the mailbox you already use.",
    id: "gmail",
    image: "/landing_sync.webp",
    imageFirst: false,
    title: "Connect Gmail",
  },
  {
    body: "support@, billing@ and press@ on your own domain, with roles.",
    id: "team-mail",
    image: "/landing_team_mail.webp",
    imageFirst: true,
    title: "Team mailboxes",
  },
  {
    body: "Send from verified domains over the API, MCP or SDK.",
    id: "sending",
    image: "/landing_sending.webp",
    imageFirst: false,
    title: "Sending",
  },
  {
    body: "Context and drafts inside one mailbox. Optional, and you send them.",
    id: "ai",
    image: "/landing_ai.webp",
    imageFirst: true,
    title: "AI",
  },
];

const ImagePlate = ({ src }: { src: string }) => (
  <div className="aspect-5/3 w-full">
    <img
      alt=""
      aria-hidden
      className="size-full object-cover"
      decoding="async"
      height="972"
      loading="lazy"
      src={src}
      style={{
        maskImage: "radial-gradient(ellipse at center, black 58%, transparent 100%)",
        WebkitMaskImage: "radial-gradient(ellipse at center, black 58%, transparent 100%)",
      }}
      width="1619"
    />
  </div>
);

const FeatureSection = ({ body, id, image, imageFirst, title }: Feature) => (
  <section className="relative px-6 pt-24 md:pt-32" id={id}>
    <div className="relative mx-auto grid w-full max-w-220 items-center gap-10 md:grid-cols-2 md:gap-14">
      <Reveal
        className={cn("flex flex-col gap-3", imageFirst && "md:order-2")}
        delay={imageFirst ? 0.08 : 0}
      >
        <h2 className="font-serif text-2xl/snug font-normal tracking-[-0.012em] text-fg md:text-[1.625rem]">
          {title}
        </h2>
        <p className="max-w-[320px] text-[15px] leading-[1.73] text-muted-fg">{body}</p>
      </Reveal>

      <Reveal className={cn(imageFirst && "md:order-1")} delay={imageFirst ? 0 : 0.08}>
        <ImagePlate src={image} />
      </Reveal>
    </div>
  </section>
);

const Pricing = () => (
  <section className="relative px-6 pt-28 md:pt-36" id="pricing">
    <div className="mx-auto w-full max-w-220">
      <Reveal
        as="h2"
        className="text-center font-serif text-2xl/snug font-normal tracking-[-0.012em] text-fg md:text-[1.625rem]"
      >
        Pricing
      </Reveal>

      <dl className="mt-12 md:mt-14">
        {Object.values(BILLING_PRODUCTS).map((product, index) => (
          <Reveal
            className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t border-border/60 px-1 py-7 last:border-b"
            delay={index * 0.07}
            key={product.name}
          >
            <dt className="w-37.5 shrink-0 text-base text-fg">{product.name}</dt>
            <dd className="min-w-60 flex-1 text-[15px] leading-[1.73] text-muted-fg">
              {product.description}
            </dd>
            <dd className="ml-auto text-base text-fg tabular-nums">
              ${product.monthlyPriceCents / 100}
            </dd>
            <dd className="w-16 text-right text-[15px] text-muted-fg/70">/ month</dd>
          </Reveal>
        ))}
      </dl>
    </div>
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
        className="max-w-205 text-center font-serif text-[1.75rem] leading-[1.42] font-normal tracking-[-0.014em] text-balance text-fg sm:text-[2.25rem] md:text-[2.875rem] md:leading-[1.48]"
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
    <div className="dark relative overflow-hidden bg-black pt-24 pb-28 md:pt-32 md:pb-36">
      <HomeWorkspaceDitherBackground
        animate
        className="opacity-30 dark:opacity-25"
        dotRgb="210, 216, 230"
        falloff={1}
        pattern="dual-foci"
        strength={1.5}
      />

      <div className="relative z-10 text-fg">
        {features.map((feature) => (
          <FeatureSection key={feature.id} {...feature} />
        ))}
        <Pricing />
      </div>
    </div>
    <Closing />
  </>
);
