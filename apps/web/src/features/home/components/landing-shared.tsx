"use client";

import { cn } from "@quieter/ui/cn";
import { m } from "motion/react";
import { type ReactNode } from "react";

export const landingEase = [0.23, 1, 0.32, 1] as const;

export const Reveal = ({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) => (
  <m.div
    className={className}
    initial={{ opacity: 0, y: 16 }}
    transition={{ delay, duration: 0.65, ease: landingEase }}
    viewport={{ margin: "-88px", once: true }}
    whileInView={{ opacity: 1, y: 0 }}
  >
    {children}
  </m.div>
);

export const SectionIntro = ({
  copy,
  index,
  label,
  title,
}: {
  copy: string;
  index: string;
  label: string;
  title: ReactNode;
}) => (
  <div className="grid gap-8 md:grid-cols-2 md:gap-16">
    <Reveal>
      <h2 className="max-w-md text-[1.9rem] leading-[1.12] font-normal tracking-tight text-foreground md:text-[2.35rem]">
        {title}
      </h2>
    </Reveal>
    <Reveal className="md:pt-2" delay={0.08}>
      <p className="max-w-md text-[15px]/6.5 text-muted-foreground">{copy}</p>
      <p className="mt-6 font-mono text-xs text-muted-foreground/60">
        <span className="text-muted-foreground/40">{index}</span>
        <span className="ml-3">{label}</span>
      </p>
    </Reveal>
  </div>
);

export const Keycap = ({
  children,
  className,
  pressed = false,
}: {
  children: ReactNode;
  className?: string;
  pressed?: boolean;
}) => (
  <kbd
    className={cn(
      "landing-keycap inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 font-mono text-[11px] text-foreground/80 squircle",
      className,
    )}
    data-pressed={pressed}
  >
    {children}
  </kbd>
);
