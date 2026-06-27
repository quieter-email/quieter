"use client";

import type { ReactNode } from "react";
import { ChromeIcon, CodeIcon, ComputerIcon, SmartPhoneIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { LinkButton } from "@quieter/ui";
import { domAnimation, LazyMotion, m } from "motion/react";
import { lazy, Suspense } from "react";
import { WorkspaceDitherBackground } from "~/components/workspace-dither-background";
import { WaitlistForm } from "./waitlist-form";

const LandingMailboxDemo = lazy(() =>
  import("~/features/home/components/landing-mailbox-demo").then((module) => ({
    default: module.LandingMailboxDemo,
  })),
);

const featureViewport = { margin: "-80px", once: true } as const;

const featureEnter = {
  initial: { opacity: 0, y: 20, filter: "blur(8px)" },
  whileInView: { opacity: 1, y: 0, filter: "blur(0px)" },
  transition: { duration: 0.8, ease: "easeOut" },
  viewport: featureViewport,
} as const;

const LandingFeatureHero = ({
  alt,
  children,
  headline,
  src,
}: {
  alt: string;
  children?: ReactNode;
  headline: string;
  src: string;
}) => (
  <div className="flex flex-col gap-16 md:gap-24">
    <m.div
      {...featureEnter}
      aria-label={alt}
      className="relative aspect-16/10 overflow-hidden rounded-2xl squircle md:rounded-4xl"
      role="img"
    >
      <img alt="" aria-hidden className="absolute inset-0 size-full object-cover" src={src} />
      <div className="absolute inset-0 bg-neutral-950/55" />
      <div className="relative flex h-full items-center justify-center px-6 md:px-10">
        <h2 className="max-w-3xl text-center text-2xl font-light tracking-tight text-balance text-white md:text-3xl lg:text-4xl">
          {headline}
        </h2>
      </div>
    </m.div>
    {children}
  </div>
);

const LandingGmailFeature = ({
  description,
  headline,
}: {
  description: string;
  headline: string;
}) => (
  <m.div {...featureEnter} className="max-w-2xl">
    <h3 className="text-xl font-light tracking-tight text-balance text-white md:text-2xl">
      {headline}
    </h3>
    <p className="mt-2 text-sm/6 text-white/55">{description}</p>
  </m.div>
);

const LandingManagedFeature = ({
  description,
  headline,
}: {
  description: string;
  headline: string;
}) => (
  <m.div {...featureEnter} className="max-w-2xl">
    <h3 className="text-xl font-light tracking-tight text-balance text-neutral-950 md:text-2xl">
      {headline}
    </h3>
    <p className="mt-2 text-sm/6 text-neutral-600">{description}</p>
  </m.div>
);

export const HomePage = () => (
  <LazyMotion features={domAnimation}>
    <m.div
      initial={{ opacity: 0, filter: "blur(8px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      transition={{ duration: 1.2, ease: "easeOut" }}
      className="relative z-10 h-dvh w-full overflow-visible bg-neutral-950 text-white will-change-[opacity,filter]"
    >
      <LinkButton
        className="fixed top-4 right-4 z-20 h-8 border-white/15 bg-white/5 px-3 text-xs text-white/50 shadow-none backdrop-blur-sm hover:bg-white/10 hover:text-white/80"
        search={{ returnTo: "/auth" }}
        to="/site-password"
        variant="outline"
      >
        Access
      </LinkButton>
      <div className="relative z-10 flex h-[calc(100dvh-min(29dvh,260px))] w-full items-center justify-center px-4 md:h-[calc(100dvh-min(41dvh,440px))] md:px-6">
        <div className="flex w-full max-w-5xl flex-col items-center gap-y-6 md:gap-y-10">
          <h1 className="max-w-4xl text-center text-3xl leading-[0.95] font-normal text-balance text-white md:text-5xl">
            <m.span
              initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ delay: 0, duration: 0.8, ease: "easeOut" }}
              className="block will-change-[transform,opacity,filter]"
            >
              The full{" "}
              <m.span
                className="relative inline-block"
                animate={{
                  color: [
                    "oklch(0.75 0.15 280)",
                    "oklch(0.75 0.15 330)",
                    "oklch(0.75 0.15 385)",
                    "oklch(0.75 0.15 330)",
                    "oklch(0.75 0.15 280)",
                  ],
                }}
                transition={{
                  duration: 10,
                  repeat: Infinity,
                }}
              >
                email
              </m.span>{" "}
              stack
            </m.span>
            <m.span
              initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ delay: 0.3, duration: 0.8, ease: "easeOut" }}
              className="block will-change-[transform,opacity,filter]"
            >
              for your every need
            </m.span>
          </h1>
          <m.h2
            initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ delay: 0.6, duration: 0.8, ease: "easeOut" }}
            className="flex w-full max-w-xs flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-center text-xs/5 font-light text-white/60 will-change-[transform,opacity,filter] md:max-w-none md:flex-nowrap md:gap-y-0 md:text-sm/6 md:whitespace-nowrap"
          >
            <span className="inline-flex items-center gap-1.5">
              <HugeiconsIcon icon={ChromeIcon} className="size-3 shrink-0 md:size-3.5" />
              <HugeiconsIcon icon={CodeIcon} className="size-3 shrink-0 md:size-3.5" />
              Available for Web and via API
            </span>
            <span
              aria-hidden
              className="hidden size-0.5 shrink-0 rounded-full bg-white/40 md:mx-1.5 md:inline-block"
            />
            <span className="inline-flex items-center gap-1.5">
              <HugeiconsIcon icon={ComputerIcon} className="size-3 shrink-0 md:size-3.5" />
              <HugeiconsIcon icon={SmartPhoneIcon} className="size-3 shrink-0 md:size-3.5" />
              <span className="md:hidden">Planned support for Desktop and Mobile</span>
              <span className="hidden md:inline">
                Planned support for all Desktop and Mobile platforms
              </span>
            </span>
          </m.h2>
          <m.div
            initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ delay: 0.9, duration: 0.8, ease: "easeOut" }}
            className="w-full max-w-sm scroll-mt-12 will-change-[transform,opacity,filter]"
            id="waitlist"
          >
            <WaitlistForm />
          </m.div>
        </div>
      </div>
      <WorkspaceDitherBackground
        className="opacity-100"
        dotRgb="21, 21, 21"
        falloff={2}
        pattern="opposing-corners"
        strength={14}
      />
      <div className="absolute bottom-0 left-1/2 z-20 w-[calc(100%-1.5rem)] -translate-x-1/2 translate-y-1/2 md:w-4/5">
        <m.div
          initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ delay: 1.2, duration: 0.8, ease: "easeOut" }}
          className="will-change-[transform,opacity,filter]"
        >
          <Suspense
            fallback={
              <div
                aria-hidden
                className="h-[min(58dvh,520px)] w-full rounded-xl border border-white/10 bg-background-dark/80 md:h-[min(82dvh,880px)] md:rounded-2xl"
              />
            }
          >
            <LandingMailboxDemo />
          </Suspense>
        </m.div>
      </div>
    </m.div>

    <m.div className="relative z-0 w-full overflow-hidden bg-neutral-200 px-6 pt-[min(29dvh,260px)] md:px-8 md:pt-[min(41dvh,440px)]">
      <div className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-center py-32 md:py-40">
        <m.h2
          {...featureEnter}
          className="max-w-3xl text-center text-2xl tracking-tight text-balance text-neutral-950 md:text-3xl"
        >
          View all your mails inside a beautiful and organized UI
        </m.h2>
      </div>
      <WorkspaceDitherBackground
        className="-scale-y-100 opacity-100"
        dotRgb="164, 164, 164"
        falloff={2}
        pattern="opposing-corners"
        strength={14}
      />
    </m.div>

    <m.div className="relative z-0 w-full overflow-hidden bg-neutral-950 px-6 py-20 text-white md:px-8 md:py-32">
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-24 md:gap-32">
        <LandingFeatureHero alt="Gmail" headline="Connect your gmail" src="/landing_gmail.webp" />

        <LandingGmailFeature
          description="Stack structured filters for status, dates, people, content, and your own labels to compose a precise query in seconds."
          headline="Search that keeps up with you"
        />

        <LandingGmailFeature
          description="New mail is auto-labeled the moment it lands. Time-sensitive details like one-time sign-in codes surface at the top, so you can copy them without ever opening the email."
          headline="Sorted before you even look"
        />

        <LandingGmailFeature
          description="Labels, drafts, reads, and more stay mirrored between Quieter and native Gmail."
          headline="Always in sync with Gmail"
        />
      </div>
      <WorkspaceDitherBackground
        className="opacity-100"
        dotRgb="21, 21, 21"
        falloff={2}
        pattern="opposing-corners"
        strength={14}
      />
    </m.div>

    <m.div className="relative z-0 w-full overflow-hidden bg-neutral-200 px-6 py-16 md:px-8 md:py-24">
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-24 md:gap-32">
        <LandingFeatureHero
          alt="Managed mail"
          headline="Or use your domain with managed mail"
          src="/landing_managed.webp"
        />

        <LandingManagedFeature
          description="Send and receive from your product with a team API key. Most teams stay inside their included credits — and overages stay cheap enough to scale without thinking twice."
          headline="Insanely cheap mail over API"
        />

        <LandingManagedFeature
          description="Verify your domain, create support@ or billing@ addresses, and start receiving real mail in minutes — no inbox forwarding hacks."
          headline="Domain to mailbox to first message"
        />

        <LandingManagedFeature
          description="Give support, press, and billing their own shared inboxes inside your organization. Managers, responders, and readers each get the access they need."
          headline="Shared inboxes for every team"
        />

        <LandingManagedFeature
          description="Pro adds AI across shared mailboxes — draft replies, summarize long threads, and keep support and press moving without everyone living in the inbox."
          headline="AI that helps the whole department"
        />
      </div>
      <WorkspaceDitherBackground
        className="-scale-y-100 opacity-100"
        dotRgb="164, 164, 164"
        falloff={2}
        pattern="opposing-corners"
        strength={14}
      />
    </m.div>
  </LazyMotion>
);
