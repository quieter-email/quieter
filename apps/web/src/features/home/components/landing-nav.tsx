"use client";

import { LinkButton } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { m, useMotionValueEvent, useScroll } from "motion/react";
import { useState, type MouseEvent } from "react";
import { landingEase } from "./landing-shared";

const sections = [
  { id: "product", label: "Product" },
  { id: "workflow", label: "Workflow" },
  { id: "teams", label: "Teams" },
  { id: "pricing", label: "Pricing" },
] as const;

const scrollToSection = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
  const target = document.getElementById(id);
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });
};

export const LandingNav = () => {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);

  useMotionValueEvent(scrollY, "change", (latest) => {
    setScrolled(latest > 16);
  });

  return (
    <m.header
      animate={{ opacity: 1, y: 0 }}
      className="fixed inset-x-0 top-0 z-40"
      initial={{ opacity: 0, y: -12 }}
      transition={{ delay: 0.15, duration: 0.7, ease: landingEase }}
    >
      <div
        className={cn(
          "absolute inset-0 transition-opacity duration-300",
          "bg-background-dark/72 backdrop-blur-md",
          scrolled ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        aria-hidden
        className={cn(
          "absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(to_right,transparent,oklch(1_0_0/0.1)_20%,oklch(1_0_0/0.1)_80%,transparent)] transition-opacity duration-300",
          scrolled ? "opacity-100" : "opacity-0",
        )}
      />
      <nav className="relative mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-5 md:px-8">
        <a
          className="text-[15px] font-normal tracking-tight text-foreground"
          href="#top"
          onClick={(event) => scrollToSection(event, "top")}
        >
          quieter
        </a>
        <div className="hidden items-center gap-1 md:flex">
          {sections.map((section) => (
            <a
              className="rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
              href={`#${section.id}`}
              key={section.id}
              onClick={(event) => scrollToSection(event, section.id)}
            >
              {section.label}
            </a>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <a
            className="hidden rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground sm:block"
            href="#waitlist"
            onClick={(event) => scrollToSection(event, "waitlist")}
          >
            Waitlist
          </a>
          <LinkButton
            className="h-8 border-white/12 bg-white/4 px-3.5 text-xs text-foreground/90 shadow-none backdrop-blur-sm hover:bg-white/10"
            search={{ returnTo: "/auth" }}
            to="/site-password"
            variant="outline"
          >
            Access
          </LinkButton>
        </div>
      </nav>
    </m.header>
  );
};
