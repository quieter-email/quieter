"use client";

import { Brand } from "@quieter/ui/brand";
import { LinkButton } from "@quieter/ui/button";
import { Link } from "@tanstack/react-router";
import { domAnimation, LazyMotion } from "motion/react";

import { HomeSections } from "./home-sections";
import { HomeSmoothScroll } from "./home-smooth-scroll";
import { HomeAtmosphericBackground } from "./lazy-webgl-backgrounds";
import { Reveal, RevealChild } from "./reveal";
import { WaitlistForm } from "./waitlist-form";

import "../home.css";

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
            <Link aria-label="Quieter home" to="/home">
              <Brand className="h-7 w-28" variant="combination" />
            </Link>
          </RevealChild>
          <RevealChild>
            <LinkButton
              className="home-access"
              search={{ returnTo: "/auth" }}
              to="/site-password"
              variant="outline"
            >
              Access
            </LinkButton>
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
