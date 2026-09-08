"use client";

import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import { MailboxPreview } from "./product-previews";
import { Reveal } from "./reveal";

const CHANNEL_MS = 10_000;
const channels = [
  {
    accounts: ["Personal", "Work", "Projects"],
    description: "Connect your Gmail accounts. Keep everything in sync.",
    id: "gmail",
    label: "Gmail",
  },
  {
    accounts: ["hello@your.team", "support@your.team", "billing@your.team"],
    description: "Mail on your domain, for yourself or your team.",
    id: "managed",
    label: "Your domain",
  },
  {
    accounts: ["Your application", "Your agent", "Your service"],
    description: "Send and receive email from your apps and agents.",
    id: "api",
    label: "API & MCP",
  },
] as const;

export const ConnectSection = ({
  paused,
  onPausedChange,
}: {
  paused: boolean;
  onPausedChange: (paused: boolean) => void;
}) => {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const interacting = hovered || focused;

  useEffect(() => {
    let timer: number | undefined;
    if (!paused && !interacting && reduced !== true) {
      timer = window.setTimeout(() => {
        setActive((current) => (current + 1) % channels.length);
        setCycle((current) => current + 1);
      }, CHANNEL_MS);
    }
    return () => {
      window.clearTimeout(timer);
    };
  }, [active, cycle, interacting, paused, reduced]);

  const channel = channels[active];
  return (
    <section
      aria-labelledby="home-connect-title"
      className="w-full max-w-6xl scroll-mt-20 px-6 text-center"
      id="features"
    >
      <Reveal>
        <h2
          className="text-3xl font-medium tracking-tight text-balance text-fg sm:text-4xl"
          id="home-connect-title"
        >
          All your email, together.
        </h2>
      </Reveal>
      <Reveal
        aria-label="Mail connection options"
        as="fieldset"
        className="mt-6 mb-8 flex flex-wrap justify-center gap-1 sm:gap-4"
        onMouseEnter={() => {
          setHovered(true);
        }}
        onMouseLeave={() => {
          setHovered(false);
        }}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setFocused(false);
          }
        }}
      >
        {channels.map((entry, index) => (
          <Button
            aria-controls="landing-channel-panel"
            aria-pressed={index === active}
            className={cn("h-11 rounded-lg px-3 text-sm font-normal", {
              "text-fg underline underline-offset-8": index === active,
              "text-muted-fg": index !== active,
            })}
            id={`landing-channel-${entry.id}`}
            key={entry.id}
            onClick={() => {
              setActive(index);
              setCycle((current) => current + 1);
            }}
            variant="ghost"
            type="button"
          >
            {entry.label}
          </Button>
        ))}
      </Reveal>
      <Reveal delay={0.1}>
        <section
          aria-labelledby={`landing-channel-${channel.id}`}
          id="landing-channel-panel"
        >
          <AnimatePresence initial={false} mode="wait">
            <m.div
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              key={channel.id}
              transition={{ duration: reduced === true ? 0.15 : 0.25 }}
            >
              <div aria-hidden className="home-product-stage">
                <MailboxPreview accounts={channel.accounts} />
              </div>
              <p className="mt-8 min-h-12 text-base leading-relaxed text-balance text-muted-fg">
                {channel.description}
              </p>
            </m.div>
          </AnimatePresence>
        </section>
      </Reveal>
      {reduced === true ? null : (
        <Button
          aria-pressed={paused}
          className="mt-4 h-9 rounded-lg px-3 text-sm font-normal text-muted-fg"
          onClick={() => {
            onPausedChange(!paused);
          }}
          variant="ghost"
          type="button"
        >
          {paused ? "Resume animations" : "Pause animations"}
        </Button>
      )}
    </section>
  );
};
