"use client";

import { hrefForSurface } from "@quieter/env/hosts";
import { Brand } from "@quieter/ui/brand";
import { buttonVariants } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Link } from "@tanstack/react-router";
import { domAnimation, LazyMotion } from "motion/react";

import { HomeSections } from "./home-sections";
import { HomeSmoothScroll } from "./home-smooth-scroll";
import { HomeAtmosphericBackground } from "./lazy-webgl-backgrounds";
import { Reveal, RevealChild } from "./reveal";
import { WaitlistForm } from "./waitlist-form";

import "../home.css";

const accessHref = hrefForSurface(
  "app",
  "/site-password",
  "?returnTo=%2Fauth",
  "",
  import.meta.env.DEV
);

const Hero = () => (
  <section className="home-hero">
    <HomeAtmosphericBackground fadeBottom="black" />
    <div className="home-hero-content">
      <h1 className="home-hero-heading">
        <Reveal onMount as="span" className="block" delay={0.2}>
          <span className="home-muted">The full</span>
          {" email "}
          <span className="home-muted">stack</span>
        </Reveal>{" "}
        <Reveal onMount as="span" className="block" delay={0.4}>
          for your every need
        </Reveal>
      </h1>
      <Reveal onMount as="p" className="home-hero-description" delay={0.62}>
        Your Gmail, your team&rsquo;s mailboxes
        <br />
        and the mail your product sends, in one place.
      </Reveal>
      <Reveal onMount className="home-waitlist-wrap" delay={0.84} id="waitlist">
        <WaitlistForm className="home-waitlist" />
      </Reveal>
    </div>
  </section>
);

export const HomePage = () => (
  <LazyMotion features={domAnimation}>
    <HomeSmoothScroll>
      <div className="home-page dark">
        <Reveal onMount as="header" className="home-navigation" stagger={0.16}>
          <RevealChild>
            <Link aria-label="quieter home" to="/home">
              <Brand className="h-7 w-28" variant="combination" />
            </Link>
          </RevealChild>
          <RevealChild>
            <a
              // oxlint-disable-next-line shadcn/no-restyle -- home-access is the documented home.css exception.
              className={cn(
                buttonVariants({ variant: "outline" }),
                "home-access"
              )}
              href={accessHref}
            >
              Access
            </a>
          </RevealChild>
        </Reveal>
        <main>
          <Hero />
          <HomeSections />
        </main>
      </div>
    </HomeSmoothScroll>
  </LazyMotion>
);
