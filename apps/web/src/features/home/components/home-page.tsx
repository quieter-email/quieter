"use client";

import { Brand } from "@quieter/ui/brand";
import { LinkButton } from "@quieter/ui/button";
import { Link } from "@tanstack/react-router";
import { domAnimation, LazyMotion } from "motion/react";
import { useEffect } from "react";

import { HomeSections } from "./home-sections";
import { HomeSmoothScroll } from "./home-smooth-scroll";
import {
  HomeAtmosphericBackground,
  preloadHomeWebglBackgrounds,
} from "./lazy-webgl-backgrounds";
import { Entrance } from "./reveal";
import { WaitlistForm } from "./waitlist-form";

const Hero = () => (
  <section className="dark relative z-10 flex min-h-[95dvh] w-full flex-col items-center justify-center overflow-hidden bg-black px-6 pt-32 pb-24 md:pt-36">
    <div className="absolute inset-0">
      <HomeAtmosphericBackground fadeBottom="black" />
    </div>

    <div className="dark relative z-10 flex w-full max-w-220 flex-col items-center text-fg">
      <h1 className="text-center font-serif text-title-lg leading-[1.32] font-normal tracking-[-0.014em] text-balance text-fg sm:text-display-md md:leading-[1.44]">
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
        className="mt-6 max-w-160 text-center text-body leading-[1.7] text-balance text-muted-fg md:text-body-lg"
        delay={0.18}
      >
        Your Gmail, your team&rsquo;s mailboxes and the mail your product sends,
        in one place.
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

export const HomePage = () => {
  useEffect(() => {
    preloadHomeWebglBackgrounds();
  }, []);

  return (
    <LazyMotion features={domAnimation}>
      <HomeSmoothScroll>
        <div className="min-h-dvh text-fg">
          <Link
            aria-label="Quieter home"
            className="dark absolute top-5 left-6 z-20 text-fg"
            to="/home"
          >
            <Brand className="h-7 w-28" variant="combination" />
          </Link>
          <LinkButton
            className="fixed top-4 right-4 z-20 h-8 border-border bg-card/60 px-3 text-caption text-muted-fg shadow-none backdrop-blur-sm hover:bg-muted hover:text-fg"
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
      </HomeSmoothScroll>
    </LazyMotion>
  );
};
