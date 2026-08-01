"use client";

import { LinkButton } from "@quieter/ui/button";
import { domAnimation, LazyMotion } from "motion/react";
import { DotField } from "./dot-field";
import { HomeSections } from "./home-sections";
import { Entrance } from "./reveal";
import { WaitlistForm } from "./waitlist-form";

const Hero = () => (
  <section className="relative flex min-h-[min(100dvh,880px)] w-full flex-col items-center justify-center overflow-hidden px-6 pt-32 pb-24 md:pt-36">
    <DotField variant="hero" />

    <div className="relative z-10 flex w-full max-w-220 flex-col items-center">
      <h1 className="text-center font-serif text-[2.125rem] leading-[1.32] font-normal tracking-[-0.014em] text-balance text-fg sm:text-[2.75rem] md:text-[3.125rem] md:leading-[1.44]">
        <Entrance as="span" className="block">
          <span className="text-muted-fg">The full</span> email{" "}
          <span className="text-muted-fg">stack</span>
        </Entrance>
        <Entrance as="span" className="block" delay={0.09}>
          for your every need
        </Entrance>
      </h1>

      <Entrance
        as="p"
        className="mt-6 max-w-160 text-center text-[15px] leading-[1.7] text-balance text-muted-fg md:text-base"
        delay={0.18}
      >
        Your Gmail, your team&rsquo;s mailboxes and the mail your product sends, in one place.
      </Entrance>

      <Entrance
        className="mt-10 flex w-full scroll-mt-24 flex-col items-center"
        delay={0.27}
        id="waitlist"
      >
        <WaitlistForm />
      </Entrance>
    </div>
  </section>
);

export const HomePage = () => (
  <LazyMotion features={domAnimation}>
    <div className="min-h-dvh bg-bg-elevated text-fg">
      <LinkButton
        className="fixed top-4 right-4 z-20 h-8 border-border bg-card/60 px-3 text-xs text-muted-fg shadow-none backdrop-blur-sm hover:bg-card hover:text-fg"
        search={{ returnTo: "/auth" }}
        to="/site-password"
        variant="outline"
      >
        Access
      </LinkButton>
      <main>
        <Hero />
        <HomeSections />
      </main>
    </div>
  </LazyMotion>
);
