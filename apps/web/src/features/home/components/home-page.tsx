"use client";

import { ChromeIcon, CodeIcon, ComputerIcon, SmartPhoneIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { LinkButton } from "@quieter/ui/button";
import { domAnimation, LazyMotion, m } from "motion/react";
import { lazy, Suspense, useEffect, useState } from "react";
import { WorkspaceDitherBackground } from "~/components/workspace-dither-background";
import { HomeSections } from "./home-sections";
import { WaitlistForm } from "./waitlist-form";

const LandingMailboxDemo = lazy(() =>
  import("./landing-mailbox-demo").then(({ LandingMailboxDemo: Component }) => ({
    default: Component,
  })),
);

const mailboxDemoFallback = (
  <div className="h-[min(58dvh,520px)] w-full rounded-xl border border-white/10 bg-bg-elevated md:h-[min(82dvh,880px)] md:rounded-2xl" />
);

const LandingMailboxDemoClient = () => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return mounted ? (
    <Suspense fallback={mailboxDemoFallback}>
      <LandingMailboxDemo />
    </Suspense>
  ) : (
    mailboxDemoFallback
  );
};

export const HomePage = () => (
  <LazyMotion features={domAnimation}>
    <div className="relative z-10 h-dvh w-full overflow-visible bg-bg-elevated text-fg">
      <LinkButton
        className="fixed top-4 right-4 z-20 h-8 border-border bg-card/60 px-3 text-xs text-muted-fg shadow-none backdrop-blur-sm hover:bg-card hover:text-fg"
        search={{ returnTo: "/auth" }}
        to="/site-password"
        variant="outline"
      >
        Access
      </LinkButton>
      <div className="relative z-10 flex h-[calc(100dvh-min(29dvh,260px))] w-full items-center justify-center px-4 md:h-[calc(100dvh-min(41dvh,440px))] md:px-6">
        <div className="flex w-full max-w-5xl flex-col items-center gap-y-6 md:gap-y-10">
          <h1 className="max-w-4xl text-center text-3xl leading-[0.95] font-normal text-balance text-fg md:text-5xl">
            <m.span
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              className="block will-change-[transform,opacity,filter]"
              initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            >
              The full{" "}
              <m.span
                animate={{
                  color: [
                    "oklch(0.75 0.15 280)",
                    "oklch(0.75 0.15 330)",
                    "oklch(0.75 0.15 385)",
                    "oklch(0.75 0.15 330)",
                    "oklch(0.75 0.15 280)",
                  ],
                }}
                className="relative inline-block"
                transition={{ duration: 10, repeat: Infinity }}
              >
                email
              </m.span>{" "}
              stack
            </m.span>
            <m.span
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              className="block will-change-[transform,opacity,filter]"
              initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
              transition={{ delay: 0.2, duration: 0.8, ease: "easeOut" }}
            >
              for your every need
            </m.span>
          </h1>
          <m.h2
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            className="flex w-full max-w-xs flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-center text-xs/5 font-light text-muted-fg will-change-[transform,opacity,filter] md:max-w-none md:flex-nowrap md:gap-y-0 md:text-sm/6 md:whitespace-nowrap"
            initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
            transition={{ delay: 0.4, duration: 0.8, ease: "easeOut" }}
          >
            <span className="inline-flex items-center gap-1.5">
              <HugeiconsIcon className="size-3 shrink-0 md:size-3.5" icon={ChromeIcon} />
              <HugeiconsIcon className="size-3 shrink-0 md:size-3.5" icon={CodeIcon} />
              Available for Web and via API
            </span>
            <span
              aria-hidden
              className="hidden size-0.5 shrink-0 rounded-full bg-muted-fg md:mx-1.5 md:inline-block"
            />
            <span className="inline-flex items-center gap-1.5">
              <HugeiconsIcon className="size-3 shrink-0 md:size-3.5" icon={ComputerIcon} />
              <HugeiconsIcon className="size-3 shrink-0 md:size-3.5" icon={SmartPhoneIcon} />
              <span className="md:hidden">Planned support for Desktop and Mobile</span>
              <span className="hidden md:inline">
                Planned support for all Desktop and Mobile platforms
              </span>
            </span>
          </m.h2>
          <m.div
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            className="w-full max-w-sm scroll-mt-12 will-change-[transform,opacity,filter]"
            id="waitlist"
            initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
            transition={{ delay: 0.6, duration: 0.8, ease: "easeOut" }}
          >
            <WaitlistForm />
          </m.div>
        </div>
      </div>
      <WorkspaceDitherBackground className="opacity-70" />
      <div className="absolute bottom-0 left-1/2 z-20 w-[calc(100%-1.5rem)] -translate-x-1/2 translate-y-1/2 md:w-4/5">
        <m.div
          animate={{ opacity: 1, transform: "translateY(0px)", filter: "blur(0px)" }}
          initial={{ opacity: 0, transform: "translateY(20px)", filter: "blur(8px)" }}
          transition={{ delay: 0.8, duration: 0.8, ease: [0.23, 1, 0.32, 1] }}
        >
          <LandingMailboxDemoClient />
        </m.div>
      </div>
    </div>

    <HomeSections />
  </LazyMotion>
);
