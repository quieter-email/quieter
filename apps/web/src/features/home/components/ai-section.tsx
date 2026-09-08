"use client";

import {
  ArrowRight01Icon,
  SparklesIcon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@quieter/ui/cn";
import type { ReactNode } from "react";

import { Reveal, RevealChild } from "./reveal";

const mails = [
  {
    icon: "/landing/vercel-mark.svg",
    label: "Development",
    sender: "Vercel",
    subject: "Your deployment is ready",
    tone: "bg-q-cyan/10 text-fg",
  },
  {
    icon: "/landing/stripe-mark.svg",
    label: "Receipts",
    sender: "Stripe",
    subject: "Your monthly invoice",
    tone: "bg-q-orange/10 text-fg",
  },
  {
    icon: "/landing/avatar-leander.png",
    label: "Personal",
    sender: "Leander",
    subject: "A few photos from Tokyo",
    tone: "bg-q-pink/10 text-fg",
  },
] as const;

const LabellingPreview = () => (
  <div className="w-full max-w-96 overflow-hidden rounded-xl border border-border/60 bg-card shadow-elevation-sm">
    <div className="flex items-center justify-between border-b border-border/40 px-4 py-3 text-xs">
      <span className="font-medium text-fg">Inbox</span>
      <span className="text-muted-fg">All caught up</span>
    </div>
    {mails.map((mail, index) => (
      <RevealChild
        className="flex items-center gap-3 border-b border-border/30 px-4 py-3 last:border-0"
        delay={0.08 + index * 0.07}
        key={mail.sender}
      >
        <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/40 bg-bg-raised">
          <img
            alt=""
            className="size-5 rounded object-contain"
            src={mail.icon}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-fg">{mail.sender}</p>
          <p className="mt-0.5 truncate text-xs text-muted-fg">
            {mail.subject}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-md px-2 py-1 text-[10px] font-medium",
            mail.tone
          )}
        >
          {mail.label}
        </span>
      </RevealChild>
    ))}
  </div>
);

const VoicePreview = () => (
  <RevealChild
    className="w-full max-w-96 rounded-xl border border-border/60 bg-card shadow-elevation-sm"
    delay={0.1}
  >
    <div className="flex items-center justify-between border-b border-border/40 px-4 py-3 text-xs">
      <span className="font-medium text-fg">A quick follow-up</span>
      <span className="rounded bg-bg-raised px-1.5 py-0.5 text-[10px] text-muted-fg">
        Draft
      </span>
    </div>
    <div className="space-y-3 px-4 py-4 text-xs leading-relaxed text-fg">
      <p>Hey Alex,</p>
      <p>
        Really enjoyed our conversation yesterday. I pulled together a few ideas
        for the project.
      </p>
      <p>
        Have a look when you get a chance. Would love to hear what you think.
      </p>
    </div>
    <div className="flex items-center gap-2 border-t border-border/40 px-4 py-2.5 text-[10px] text-muted-fg">
      <HugeiconsIcon className="size-3.5 shrink-0" icon={SparklesIcon} />
      Written in your voice, ready for your review
    </div>
  </RevealChild>
);

const BriefPreview = () => (
  <RevealChild
    className="w-full max-w-96 rounded-xl border border-border/60 bg-card p-4 shadow-elevation-sm"
    delay={0.1}
  >
    <div className="mb-4 flex items-center gap-2 text-[10px] font-medium tracking-wider text-muted-fg uppercase">
      <span className="size-1.5 rounded-full bg-q-green" />
      Your morning brief
    </div>
    <p className="font-serif text-lg text-fg">
      A little clarity to start your day.
    </p>
    <div className="mt-4 space-y-3">
      {[
        {
          detail: "Alex is ready for the next steps.",
          time: "09:12",
          title: "The proposal is approved",
        },
        {
          detail: "Your itinerary is in your inbox.",
          time: "08:45",
          title: "Your trip is confirmed",
        },
      ].map((item) => (
        <div
          className="flex items-start gap-3 border-t border-border/40 pt-3"
          key={item.title}
        >
          <span className="pt-0.5 font-mono text-[10px] text-muted-fg">
            {item.time}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-fg">{item.title}</p>
            <p className="mt-1 text-xs text-muted-fg">{item.detail}</p>
          </div>
          <HugeiconsIcon
            className="mt-0.5 size-3.5 shrink-0 text-muted-fg"
            icon={ArrowRight01Icon}
          />
        </div>
      ))}
    </div>
  </RevealChild>
);

const ChatPreview = () => (
  <div className="flex w-full max-w-96 flex-col gap-3 text-xs leading-relaxed">
    <RevealChild
      className="ml-8 self-end rounded-2xl rounded-tr-sm border border-border/50 bg-bg-raised px-4 py-3 text-fg"
      delay={0.08}
    >
      What did Alex say about the proposal?
    </RevealChild>
    <RevealChild
      className="mr-5 rounded-2xl rounded-tl-sm border border-border/60 bg-card p-4 shadow-elevation-sm"
      delay={0.18}
    >
      <div className="mb-2 flex items-center gap-2 text-[10px] font-medium text-muted-fg">
        <HugeiconsIcon className="size-3.5" icon={SparklesIcon} />
        Quieter
      </div>
      <p className="text-fg">
        Alex approved the direction and asked for a timeline by Friday.
      </p>
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-border/50 bg-bg-surface px-3 py-2 text-[10px] text-muted-fg">
        <HugeiconsIcon className="size-3.5 shrink-0" icon={Tick01Icon} />
        Re: Project proposal
        <HugeiconsIcon
          className="ml-auto size-3.5 shrink-0"
          icon={ArrowRight01Icon}
        />
      </div>
    </RevealChild>
  </div>
);

const FeaturePreview = ({
  children,
  title,
  description,
  delay = 0,
}: {
  children: ReactNode;
  title: string;
  description: string;
  delay?: number;
}) => (
  <Reveal
    className="overflow-hidden rounded-2xl border border-border/60 bg-card/80 shadow-elevation-sm"
    delay={delay}
  >
    <div
      aria-hidden
      className="flex min-h-72 items-center justify-center bg-linear-to-br from-bg-raised/80 to-bg-surface/40 p-5 sm:p-7 md:h-80 lg:h-72"
    >
      {children}
    </div>
    <div className="border-t border-border/40 px-6 py-5 sm:px-7">
      <h3 className="text-base font-medium tracking-tight text-fg">{title}</h3>
      <p className="mt-2 max-w-96 text-sm leading-relaxed text-pretty text-muted-fg">
        {description}
      </p>
    </div>
  </Reveal>
);

export const AiSection = () => (
  <section aria-labelledby="home-ai-title" className="w-full max-w-6xl px-6">
    <Reveal className="mx-auto mb-10 max-w-xl text-center">
      <p className="mb-3 text-xs font-medium tracking-widest text-muted-fg uppercase">
        A helping hand
      </p>
      <h2
        className="font-serif text-2xl leading-snug tracking-tight text-balance text-fg sm:text-3xl"
        id="home-ai-title"
      >
        Less busywork. More breathing room.
      </h2>
      <p className="mt-4 text-sm leading-relaxed text-pretty text-muted-fg">
        A little help with the repetitive parts of email. Turn on the AI
        features you want, and leave the rest off.
      </p>
    </Reveal>
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      <FeaturePreview
        title="An inbox that sorts itself"
        description="Labels that follow your preferences, so the right emails find their place."
      >
        <LabellingPreview />
      </FeaturePreview>
      <FeaturePreview
        title="Your words, with a head start"
        description="Draft replies that sound like you. Make them yours, then send when you're ready."
        delay={0.06}
      >
        <VoicePreview />
      </FeaturePreview>
      <FeaturePreview
        title="The important parts, together"
        description="Get a daily brief of what needs your attention without opening every thread."
        delay={0.06}
      >
        <BriefPreview />
      </FeaturePreview>
      <FeaturePreview
        title="Ask your inbox"
        description="Find the details, catch up on a conversation, or work on a reply in chat."
        delay={0.12}
      >
        <ChatPreview />
      </FeaturePreview>
    </div>
  </section>
);
