"use client";

import { cn } from "@quieter/ui/cn";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { Reveal } from "./reveal";

const VERB_MS = 5000;
const CHANNEL_MS = 10_000;
const VERBS = ["send", "receive"] as const;
const EASE = [0.23, 1, 0.32, 1] as const;
const TAB_LEFTS = [32, 491, 941] as const;

const channels = [
  { id: "gmail", index: "01", label: "Gmail" },
  { id: "managed", index: "02", label: "Managed mailboxes" },
  { id: "api", index: "03", label: "API & MCP" },
] as const;

type ChannelId = (typeof channels)[number]["id"];

const VerbSwitcher = () => {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIndex((current) => (current + 1) % VERBS.length);
    }, VERB_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [index]);

  const verb = VERBS[index];

  return (
    <span
      aria-hidden
      className="relative inline-block w-[180px] overflow-hidden text-center align-baseline"
    >
      <span className="invisible">receive</span>
      <AnimatePresence initial={false} mode="wait">
        <m.span
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          className="absolute inset-x-0 top-0 text-center"
          exit={
            reduced === true
              ? { opacity: 0 }
              : { opacity: 0, transform: "translateY(-32px)" }
          }
          initial={
            reduced === true
              ? { opacity: 0 }
              : { opacity: 0, transform: "translateY(32px)" }
          }
          key={verb}
          transition={{ duration: reduced === true ? 0.18 : 0.48, ease: EASE }}
        >
          {verb}
        </m.span>
      </AnimatePresence>
    </span>
  );
};

const Tile = ({
  box,
  children,
  left,
  rotate,
  size,
  top,
}: {
  box: number;
  children: ReactNode;
  left: number;
  rotate: number;
  size: number;
  top: number;
}) => (
  <div
    className="absolute flex items-center justify-center"
    style={{ height: box, left, top, width: box }}
  >
    <div className="flex-none" style={{ rotate: `${rotate}deg` }}>
      <div
        className="relative overflow-hidden rounded-[12px] bg-fg"
        style={{ height: size, width: size }}
      >
        {children}
      </div>
    </div>
  </div>
);

const tilePositions = [
  { box: 63.53, left: 123.5, rotate: -14.84, size: 51.955, top: 174.5 },
  { box: 45.462, left: 216.5, rotate: 14.35, size: 37.368, top: 115.5 },
  { box: 72.835, left: 162.5, rotate: -4.23, size: 68, top: 137.5 },
] as const;

const ChannelGlyph = ({ channel }: { channel: ChannelId }) => {
  if (channel === "gmail") {
    return (
      <img
        alt=""
        className="absolute inset-[27.94%_20.59%_28.3%] size-[58.82%]"
        src="/landing/gmail-mark.svg"
      />
    );
  }

  return (
    <span className="absolute inset-0 flex items-center justify-center font-serif text-[15px] text-bg-surface italic">
      {channel === "managed" ? "@" : "{ }"}
    </span>
  );
};

const TileCluster = ({ channel }: { channel: ChannelId }) => (
  <>
    {tilePositions.map((tile) => (
      <Tile {...tile} key={tile.left}>
        <ChannelGlyph channel={channel} />
      </Tile>
    ))}
  </>
);

export const ConnectSection = () => {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setActive((current) => (current + 1) % channels.length);
      setCycle((current) => current + 1);
    }, CHANNEL_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [active, cycle]);

  const channel = channels[active];

  return (
    <>
      <Reveal className="relative h-[181px] w-[839px] overflow-hidden">
        <h2 className="absolute top-[62px] left-[65px] flex items-baseline font-serif text-[48px] whitespace-nowrap text-fg italic">
          How do you want to
          <span className="sr-only"> send or receive </span>
          <VerbSwitcher />?
        </h2>
      </Reveal>

      <div className="relative flex w-full flex-col items-center gap-[51px] overflow-hidden p-[100px]">
        <Reveal
          aria-label="Mail connection options"
          className="relative h-[106px] w-[1342px]"
          delay={0.06}
          role="tablist"
        >
          {channels.map((entry, index) => (
            <button
              aria-controls="landing-channel-panel"
              aria-selected={index === active}
              className="absolute top-[42px] h-[42px] w-[369px] text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
              id={`landing-channel-${entry.id}`}
              key={entry.id}
              onClick={() => {
                setActive(index);
                setCycle((current) => current + 1);
              }}
              role="tab"
              style={{ left: TAB_LEFTS[index] }}
              type="button"
            >
              <span className="absolute inset-x-0 top-0 h-px bg-fg/15" />
              {index === active ? (
                <m.span
                  animate={{ transform: "scaleX(1)" }}
                  className="absolute inset-x-0 top-0 h-px origin-left bg-fg/70"
                  initial={{ transform: "scaleX(0)" }}
                  key={`${entry.id}-${cycle}`}
                  transition={{
                    duration: reduced === true ? 0 : CHANNEL_MS / 1000,
                    ease: "linear",
                  }}
                />
              ) : null}
              <span
                className={cn(
                  "absolute top-[12px] left-[5px] text-[20px] whitespace-nowrap transition-colors duration-500",
                  {
                    "text-fg": index === active,
                    "text-muted-fg": index !== active,
                  }
                )}
              >
                <span className="font-serif">{entry.index}</span>
                <span className="font-sans">{` ${entry.label}`}</span>
              </span>
            </button>
          ))}
        </Reveal>

        <Reveal
          aria-labelledby={`landing-channel-${channel.id}`}
          className="relative h-[355px] w-[1278px] overflow-hidden rounded-[12px] border border-black/10 bg-bg-raised shadow-elevation-sm"
          delay={0.12}
          id="landing-channel-panel"
          role="tabpanel"
        >
          <AnimatePresence initial={false} mode="wait">
            <m.div
              animate={{ filter: "blur(0px)", opacity: 1 }}
              className="absolute inset-0"
              exit={
                reduced === true
                  ? { opacity: 0 }
                  : { filter: "blur(12px)", opacity: 0 }
              }
              initial={
                reduced === true
                  ? { opacity: 0 }
                  : { filter: "blur(12px)", opacity: 0 }
              }
              key={channel.id}
              transition={{
                duration: reduced === true ? 0.18 : 0.46,
                ease: EASE,
              }}
            >
              <TileCluster channel={channel.id} />

              <img
                alt=""
                className="absolute top-[104.5px] left-[348.5px] h-[139.562px] w-[589px]"
                src="/landing/flow-curve.svg"
              />

              <div className="absolute top-[81.5px] left-[1024.5px] flex size-[179.288px] items-center justify-center">
                <div className="flex-none rotate-[8.24deg]">
                  <img
                    alt=""
                    className="size-[158.247px] object-cover"
                    src="/landing/quieter-mark.png"
                  />
                </div>
              </div>
            </m.div>
          </AnimatePresence>
        </Reveal>
      </div>
    </>
  );
};
