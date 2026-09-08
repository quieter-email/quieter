"use client";

import { Mail01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Brand } from "@quieter/ui/brand";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

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
      className="w-full max-w-xl scroll-mt-20 px-6 text-center"
      id="features"
    >
      <Reveal>
        <h2
          className="text-2xl font-normal text-balance text-fg"
          id="home-connect-title"
        >
          All your email, together.
        </h2>
      </Reveal>
      <Reveal
        aria-label="Mail connection options"
        as="fieldset"
        className="mt-8 flex flex-wrap justify-center gap-1 sm:gap-4"
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
              <div
                aria-hidden
                className="flex h-64 items-center justify-center text-left"
              >
                <div className="grid w-full max-w-96 grid-cols-[minmax(0,1fr)_48px_56px] items-center sm:grid-cols-[minmax(0,1fr)_80px_64px]">
                  <div className="space-y-6">
                    {channel.accounts.map((account) => (
                      <div className="flex items-center gap-3" key={account}>
                        {channel.id === "gmail" ? (
                          <img
                            alt=""
                            className="size-5 shrink-0"
                            src="/landing/gmail-mark.svg"
                          />
                        ) : (
                          <HugeiconsIcon
                            className="size-5 shrink-0 text-muted-fg"
                            icon={Mail01Icon}
                          />
                        )}
                        <span className="truncate text-sm text-muted-fg">
                          {account}
                        </span>
                      </div>
                    ))}
                  </div>
                  <img
                    alt=""
                    className="h-24 w-full opacity-40 invert"
                    src="/landing/flow-curve.svg"
                  />
                  <Brand className="size-12 text-fg" />
                </div>
              </div>
              <p className="min-h-12 text-sm leading-relaxed text-balance text-muted-fg">
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
