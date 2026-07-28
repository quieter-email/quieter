"use client";

import { cn } from "@quieter/ui/cn";
import { m, useReducedMotion } from "motion/react";
import { Reveal, SectionIntro } from "./landing-shared";

const RING_RADIUS = 9;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const CountdownRing = () => {
  const reducedMotion = useReducedMotion();

  return (
    <svg aria-hidden className="size-6 -rotate-90" viewBox="0 0 24 24">
      <circle
        cx="12"
        cy="12"
        fill="none"
        r={RING_RADIUS}
        stroke="oklch(1 0 0 / 0.1)"
        strokeWidth="2"
      />
      <m.circle
        animate={
          reducedMotion
            ? { strokeDashoffset: RING_CIRCUMFERENCE * 0.35 }
            : { strokeDashoffset: [0, RING_CIRCUMFERENCE] }
        }
        cx="12"
        cy="12"
        fill="none"
        r={RING_RADIUS}
        stroke="oklch(0.62 0.08 149.57)"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeLinecap="round"
        strokeWidth="2"
        transition={reducedMotion ? undefined : { duration: 9, ease: "linear", repeat: Infinity }}
      />
    </svg>
  );
};

const labelRows = [
  {
    chip: { className: "bg-label-purple-solid/12 text-label-purple-solid", name: "Product" },
    sender: "Grid Garden",
    subject: "Changelog for week 30",
    time: "11:02",
  },
  {
    chip: { className: "bg-label-orange-solid/12 text-label-orange-solid", name: "Finance" },
    sender: "Moonbase Finance",
    subject: "Your tax invoice is ready",
    time: "10:31",
  },
  {
    chip: { className: "bg-label-blue-solid/12 text-label-blue-solid", name: "Billing" },
    sender: "Forgekeeper",
    subject: "Question about our invoice",
    time: "09:52",
  },
  {
    chip: { className: "bg-label-green-solid/12 text-label-green-solid", name: "Travel" },
    sender: "Northwind Air",
    subject: "Your itinerary for August 4",
    time: "09:18",
  },
] as const;

const SignalVisual = () => (
  <div className="overflow-hidden rounded-xl border border-white/8 bg-[oklch(0.168_0.002_264)] shadow-[0_32px_80px_-24px_oklch(0_0_0/0.6)] squircle">
    <div className="grid md:grid-cols-[1.45fr_1fr]">
      <div className="border-b border-white/6 md:border-r md:border-b-0">
        <div className="border-b border-white/6 px-5 py-3 text-xs text-muted-foreground">
          Labels follow your criteria
        </div>
        {labelRows.map((row, index) => (
          <div
            className={cn("flex items-center gap-4 px-5 py-3.5", {
              "border-b border-white/5": index < labelRows.length - 1,
            })}
            key={row.subject}
          >
            <span className="w-32 shrink-0 truncate text-[13px] text-foreground/80">
              {row.sender}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground/70">
              {row.subject}
            </span>
            <m.span
              className={cn(
                "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] squircle",
                row.chip.className,
              )}
              initial={{ opacity: 0, scale: 0.85 }}
              transition={{
                delay: 0.4 + index * 0.25,
                duration: 0.4,
                ease: [0.23, 1, 0.32, 1],
              }}
              viewport={{ margin: "-96px", once: true }}
              whileInView={{ opacity: 1, scale: 1 }}
            >
              {row.chip.name}
            </m.span>
            <span className="hidden shrink-0 text-xs text-muted-foreground/50 tabular-nums sm:inline">
              {row.time}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-col">
        <div className="border-b border-white/6 px-5 py-3 text-xs text-muted-foreground">
          Useful details
        </div>
        <div className="flex flex-1 flex-col justify-center gap-6 px-5 py-6">
          <m.div
            initial={{ opacity: 0, y: 12 }}
            transition={{ delay: 0.5, duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
            viewport={{ margin: "-96px", once: true }}
            whileInView={{ opacity: 1, y: 0 }}
          >
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Sign-in code, Northwind ID</p>
              <CountdownRing />
            </div>
            <p className="mt-2 font-mono text-[1.7rem] tracking-[0.2em] text-foreground">404 137</p>
          </m.div>
          <div className="h-px bg-white/6" />
          <m.div
            initial={{ opacity: 0, y: 12 }}
            transition={{ delay: 0.75, duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
            viewport={{ margin: "-96px", once: true }}
            whileInView={{ opacity: 1, y: 0 }}
          >
            <p className="text-xs text-muted-foreground">Flight, August 4</p>
            <p className="mt-2 text-sm text-foreground/85">AMS to LIS, seat 14A</p>
            <p className="mt-1 text-xs text-muted-foreground/60">Check-in opens in 3 days</p>
          </m.div>
        </div>
      </div>
    </div>
  </div>
);

export const LandingSignalSection = () => (
  <section className="px-5 py-28 md:px-8 md:py-40">
    <div className="mx-auto w-full max-w-6xl">
      <SectionIntro
        copy="Codes, dates, and deadlines surface the moment they matter and step aside once they no longer do. Labels apply themselves, using only labels you already have and only with direct evidence. Both are separate, per-mailbox settings."
        index="2.0"
        label="Signal"
        title={
          <>
            The important part,
            <br />
            surfaced on time
          </>
        }
      />
      <Reveal className="mt-14 md:mt-20" delay={0.1}>
        <SignalVisual />
      </Reveal>
    </div>
  </section>
);
