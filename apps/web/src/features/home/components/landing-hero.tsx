"use client";

import { m, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { WorkspaceDitherBackground } from "~/components/workspace-dither-background";
import { landingEase } from "./landing-shared";
import { WaitlistForm } from "./waitlist-form";

const LandingMailboxDemo = lazy(() =>
  import("./landing-mailbox-demo").then(({ LandingMailboxDemo: Component }) => ({
    default: Component,
  })),
);

const demoPlaceholder = (
  <div className="h-[min(58dvh,520px)] w-full rounded-xl border border-white/8 bg-background-dark md:h-[min(82dvh,880px)] md:rounded-2xl" />
);

const LandingMailboxDemoClient = () => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return demoPlaceholder;

  return (
    <Suspense fallback={demoPlaceholder}>
      <LandingMailboxDemo />
    </Suspense>
  );
};

const enter = (delay: number) => ({
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  initial: { opacity: 0, y: 18, filter: "blur(6px)" },
  transition: { delay, duration: 0.8, ease: landingEase },
});

const ScrollTiltDemo = () => {
  const frameRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    offset: ["start end", "start 0.4"],
    target: frameRef,
  });
  const progress = useSpring(scrollYProgress, { damping: 28, mass: 0.6, stiffness: 160 });
  const rotateX = useTransform(progress, [0, 1], [7, 0]);
  const scale = useTransform(progress, [0, 1], [0.97, 1]);

  return (
    <div className="perspective-[1600px]" ref={frameRef}>
      <m.div
        className="relative will-change-transform"
        style={reducedMotion ? undefined : { rotateX, scale }}
      >
        <div
          aria-hidden
          className="absolute inset-x-[16%] -top-24 h-40 bg-[radial-gradient(ellipse_60%_100%_at_50%_100%,oklch(0.9_0.01_290/0.1),transparent_70%)] blur-2xl"
        />
        <div
          aria-hidden
          className="absolute inset-x-[10%] -top-px z-10 h-px bg-[linear-gradient(to_right,transparent,oklch(1_0_0/0.55),transparent)]"
        />
        <LandingMailboxDemoClient />
      </m.div>
    </div>
  );
};

export const LandingHero = () => (
  <section className="relative overflow-hidden" id="top">
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-168 mask-[linear-gradient(to_bottom,black,transparent)]"
    >
      <WorkspaceDitherBackground className="opacity-80" strength={8} />
    </div>

    <div className="relative z-10 mx-auto w-full max-w-6xl px-5 pt-36 md:px-8 md:pt-48">
      <h1 className="max-w-3xl text-[2.6rem] leading-[1.06] font-light tracking-tight text-foreground md:text-6xl">
        <m.span {...enter(0.1)} className="block will-change-[transform,opacity,filter]">
          The full email stack.
        </m.span>
        <m.span
          {...enter(0.22)}
          className="block text-foreground/50 will-change-[transform,opacity,filter]"
        >
          Finally quiet.
        </m.span>
      </h1>

      <div className="mt-9 flex flex-col gap-10 md:flex-row md:items-end md:justify-between">
        <m.p {...enter(0.36)} className="max-w-md text-[15px]/6.5 text-muted-foreground">
          Gmail, mailboxes on your own domain, shared team workflows, and a send API. One calm,
          keyboard-fast workspace.
        </m.p>
        <m.div {...enter(0.46)} className="w-full max-w-sm scroll-mt-28" id="waitlist">
          <WaitlistForm />
        </m.div>
      </div>

      <m.div
        animate={{ opacity: 1 }}
        className="mt-16 md:mt-24"
        initial={{ opacity: 0 }}
        transition={{ delay: 0.6, duration: 1, ease: landingEase }}
      >
        <ScrollTiltDemo />
      </m.div>
    </div>
  </section>
);
