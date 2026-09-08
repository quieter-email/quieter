"use client";

import { ArrowRight01Icon, Mail01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Brand } from "@quieter/ui/brand";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import { Reveal } from "./reveal";

const CHANNEL_MS = 10_000;
const EASE = [0.23, 1, 0.32, 1] as const;

const channels = [
  {
    accounts: ["Personal", "Work", "Projects"],
    description:
      "Bring your Gmail accounts together in a calmer workspace. Your mail stays in sync, so you can pick up right where you left off.",
    detail: "Two-way sync with Gmail",
    id: "gmail",
    index: "01",
    label: "Gmail",
    title: "Your familiar inbox. A fresh perspective.",
  },
  {
    accounts: ["hello@your.team", "support@your.team", "billing@your.team"],
    description:
      "Give your work its own address. Keep mailboxes private, or share them with your team and choose who has access.",
    detail: "Mail on your own domain",
    id: "managed",
    index: "02",
    label: "Managed mailboxes",
    title: "Your domain. A place for every conversation.",
  },
  {
    accounts: ["Your application", "Your agent", "Your service"],
    description:
      "Send and receive mail from the tools you build. Connect your application or agent through the API, MCP, or SDK.",
    detail: "Built for your apps and agents",
    id: "api",
    index: "03",
    label: "API & MCP",
    title: "Email belongs in your workflow.",
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
      className="w-full max-w-6xl px-6"
      id="features"
    >
      <Reveal className="mx-auto mb-10 max-w-xl text-center">
        <p className="mb-3 text-xs font-medium tracking-widest text-muted-fg uppercase">
          Make yourself at home
        </p>
        <h2
          className="font-serif text-2xl leading-snug tracking-tight text-balance text-fg sm:text-3xl"
          id="home-connect-title"
        >
          However you email, it belongs here.
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-pretty text-muted-fg">
          Your personal mail, your team, and the things you build. All in one
          place.
        </p>
      </Reveal>
      <Reveal
        aria-label="Mail connection options"
        as="fieldset"
        className="mx-auto mb-5 grid w-full max-w-2xl grid-cols-1 gap-1.5 rounded-2xl border border-border/50 bg-bg-raised/70 p-1.5 sm:grid-cols-3"
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
            className={cn(
              "relative h-11 min-w-0 justify-start gap-2.5 overflow-hidden rounded-xl border px-4 text-left text-xs transition-colors sm:justify-center",
              {
                "border-border/60 bg-card text-fg shadow-sm hover:bg-card":
                  index === active,
                "border-transparent text-muted-fg hover:bg-card/50":
                  index !== active,
              }
            )}
            id={`landing-channel-${entry.id}`}
            key={entry.id}
            onClick={() => {
              setActive(index);
              setCycle((current) => current + 1);
            }}
            variant="ghost"
            type="button"
          >
            <span className="font-mono text-[10px] text-muted-fg">
              {entry.index}
            </span>
            {entry.label}
            {index === active ? (
              <m.span
                animate={{ transform: "scaleX(1)" }}
                className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-fg/20"
                initial={{
                  transform:
                    paused || interacting || reduced === true
                      ? "scaleX(1)"
                      : "scaleX(0)",
                }}
                key={`${entry.id}-${cycle}`}
                transition={{
                  duration:
                    paused || interacting || reduced === true
                      ? 0
                      : CHANNEL_MS / 1000,
                  ease: "linear",
                }}
              />
            ) : null}
          </Button>
        ))}
      </Reveal>
      <Reveal
        className="overflow-hidden rounded-2xl border border-border/60 bg-card/80 shadow-elevation-sm"
        delay={0.1}
      >
        <section
          aria-labelledby={`landing-channel-${channel.id}`}
          id="landing-channel-panel"
        >
          <AnimatePresence initial={false} mode="wait">
            <m.div
              animate={{ opacity: 1, transform: "translateY(0px)" }}
              className="grid min-h-80 items-center md:grid-cols-2"
              exit={{ opacity: 0 }}
              initial={{
                opacity: 0,
                transform:
                  reduced === true ? "translateY(0px)" : "translateY(6px)",
              }}
              key={channel.id}
              transition={{
                duration: reduced === true ? 0.15 : 0.25,
                ease: EASE,
              }}
            >
              <div className="px-7 pt-8 pb-5 sm:px-10 md:py-10">
                <p className="mb-4 text-xs font-medium text-muted-fg">
                  {channel.label}
                </p>
                <h3 className="max-w-80 font-serif text-xl leading-snug tracking-tight text-balance text-fg sm:text-2xl">
                  {channel.title}
                </h3>
                <p className="mt-4 max-w-88 text-sm leading-relaxed text-pretty text-muted-fg">
                  {channel.description}
                </p>
                <p className="mt-6 flex items-center gap-2 text-xs font-medium text-fg">
                  <HugeiconsIcon
                    aria-hidden
                    className="size-3.5"
                    icon={ArrowRight01Icon}
                  />
                  {channel.detail}
                </p>
              </div>
              <div
                aria-hidden
                className="flex min-h-64 items-center justify-center bg-linear-to-br from-bg-raised/60 to-transparent px-6 py-8 sm:px-10 md:min-h-80"
              >
                <div className="grid w-full max-w-96 grid-cols-[minmax(0,1fr)_48px_64px] items-center sm:grid-cols-[minmax(0,1fr)_72px_80px]">
                  <div className="space-y-3">
                    {channel.accounts.map((account, index) => (
                      <div
                        className={cn(
                          "flex items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-3 shadow-elevation-sm",
                          { "translate-x-2": index === 1 }
                        )}
                        key={account}
                      >
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-bg-raised">
                          {channel.id === "gmail" ? (
                            <img
                              alt=""
                              className="size-4"
                              src="/landing/gmail-mark.svg"
                            />
                          ) : (
                            <HugeiconsIcon
                              className="size-4 text-muted-fg"
                              icon={Mail01Icon}
                            />
                          )}
                        </div>
                        <span className="truncate text-xs font-medium text-fg">
                          {account}
                        </span>
                      </div>
                    ))}
                  </div>
                  <img
                    alt=""
                    className="h-24 w-full opacity-40"
                    src="/landing/flow-curve.svg"
                  />
                  <div className="flex flex-col items-center gap-3">
                    <div className="flex size-16 items-center justify-center rounded-2xl border border-fg/10 bg-fg shadow-elevation sm:size-20">
                      <Brand className="size-8 text-bg-surface sm:size-10" />
                    </div>
                    <span className="text-xs font-medium text-muted-fg">
                      Quieter
                    </span>
                  </div>
                </div>
              </div>
            </m.div>
          </AnimatePresence>
        </section>
      </Reveal>
      {reduced === true ? null : (
        <div className="mt-3 flex justify-end">
          <Button
            aria-pressed={paused}
            className="h-8 rounded-lg px-3 text-xs text-muted-fg"
            onClick={() => {
              onPausedChange(!paused);
            }}
            variant="ghost"
            type="button"
          >
            {paused ? "Resume animations" : "Pause animations"}
          </Button>
        </div>
      )}
    </section>
  );
};
