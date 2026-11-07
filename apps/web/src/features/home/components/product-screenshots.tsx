"use client";

import { cn } from "@quieter/ui/cn";
import { m, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";

import { HomeAtmosphericBackground } from "./lazy-webgl-backgrounds";

type ScreenshotSource = {
  src: string;
  width: number;
  height: number;
};

type ProductScreenshotLayer = {
  alt: string;
  desktop: ScreenshotSource;
  id: "primary" | "context";
  mobile: ScreenshotSource;
};

const screenshots = {
  assistant: [
    {
      alt: "The source conversation in Quieter.",
      desktop: {
        height: 744,
        src: "/landing/assistant-source.png",
        width: 388,
      },
      id: "context",
      mobile: { height: 744, src: "/landing/assistant-source.png", width: 388 },
    },
    {
      alt: "Quieter Gmail assistant summarizing the conversation with a source email.",
      desktop: { height: 620, src: "/landing/assistant.png", width: 390 },
      id: "primary",
      mobile: { height: 620, src: "/landing/assistant.png", width: 390 },
    },
  ],
  calendar: [
    {
      alt: "Quieter calendar with a week of scheduled events.",
      desktop: { height: 618, src: "/landing/calendar.png", width: 570 },
      id: "primary",
      mobile: { height: 618, src: "/landing/calendar.png", width: 570 },
    },
    {
      alt: "The calendar month picker in Quieter.",
      desktop: { height: 282, src: "/landing/calendar-month.png", width: 236 },
      id: "context",
      mobile: { height: 282, src: "/landing/calendar-month.png", width: 236 },
    },
  ],
  compose: [
    {
      alt: "An email draft in Quieter, with recipient, subject, and writing tools.",
      desktop: { height: 400, src: "/landing/compose.png", width: 880 },
      id: "primary",
      mobile: { height: 420, src: "/landing/compose-mobile.png", width: 358 },
    },
  ],
  inbox: [
    {
      alt: "Quieter inbox with messages, labels, and a reading pane.",
      desktop: { height: 960, src: "/landing/inbox.png", width: 1440 },
      id: "primary",
      mobile: { height: 844, src: "/landing/inbox-mobile.png", width: 390 },
    },
  ],
} satisfies Record<string, ProductScreenshotLayer[]>;

export const ProductScreenshotStage = ({
  screenshot,
}: {
  screenshot: keyof typeof screenshots;
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    offset: ["start end", "end start"],
    target: stageRef,
  });
  const transform = useTransform(
    scrollYProgress,
    [0, 1],
    ["translateY(8px)", "translateY(-8px)"]
  );
  const contextTransform = useTransform(
    scrollYProgress,
    [0, 1],
    ["translateY(-6px)", "translateY(6px)"]
  );
  const transforms = { context: contextTransform, primary: transform };

  return (
    <div
      className={cn("home-screenshot-stage", {
        "home-screenshot-assistant": screenshot === "assistant",
        "home-screenshot-calendar": screenshot === "calendar",
        "home-screenshot-compose": screenshot === "compose",
        "home-screenshot-inbox": screenshot === "inbox",
      })}
      ref={stageRef}
    >
      {screenshot === "compose" ? null : (
        <HomeAtmosphericBackground
          className="home-product-atmosphere"
          interactive={false}
          intensity={0.35}
        />
      )}
      {screenshots[screenshot].map(({ alt, desktop, id, mobile }) => (
        <m.picture
          className={cn("home-product-picture", {
            "home-picture-context": id === "context",
          })}
          key={id}
          // oxlint-disable-next-line shadcn/no-inline-styles -- The screenshot artwork follows bounded foreground and background scroll transforms.
          style={{ transform: reduced === true ? "none" : transforms[id] }}
        >
          <source
            height={mobile.height}
            media="(max-width: 767px)"
            srcSet={mobile.src}
            width={mobile.width}
          />
          <img
            alt={alt}
            decoding="async"
            draggable={false}
            height={desktop.height}
            loading="lazy"
            src={desktop.src}
            width={desktop.width}
          />
        </m.picture>
      ))}
    </div>
  );
};
