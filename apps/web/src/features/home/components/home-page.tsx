"use client";

import { domAnimation, LazyMotion } from "motion/react";
import { LandingHero } from "./landing-hero";
import { LandingNav } from "./landing-nav";
import { LandingClosingSection, LandingPricingSection } from "./landing-pricing-section";
import { LandingSignalSection } from "./landing-signal-section";
import { LandingStatementSection } from "./landing-statement-section";
import { LandingAssistSection, LandingTeamsSection } from "./landing-teams-section";
import { LandingTriageSection } from "./landing-triage-section";
import "./landing.css";

export const HomePage = () => (
  <LazyMotion features={domAnimation}>
    <div className="relative bg-background-dark text-foreground">
      <LandingNav />
      <LandingHero />
      <LandingStatementSection />
      <LandingTriageSection />
      <LandingSignalSection />
      <LandingTeamsSection />
      <LandingAssistSection />
      <LandingPricingSection />
      <LandingClosingSection />
    </div>
  </LazyMotion>
);
