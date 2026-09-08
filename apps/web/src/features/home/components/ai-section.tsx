"use client";

import { cn } from "@quieter/ui/cn";
import type { ReactNode } from "react";

import { Reveal, RevealChild } from "./reveal";

const mails = [
  {
    icon: "/landing/vercel-mark.svg",
    label: "Work",
    sender: "Vercel",
    subject: "Your deployment is ready",
    tone: "bg-q-cyan/10",
  },
  {
    icon: "/landing/stripe-mark.svg",
    label: "Receipts",
    sender: "Stripe",
    subject: "Your monthly invoice",
    tone: "bg-q-orange/10",
  },
  {
    icon: "/landing/avatar-leander.png",
    label: "Personal",
    sender: "Leander",
    subject: "Photos from Tokyo",
    tone: "bg-q-pink/10",
  },
] as const;

const LabellingPreview = () => (
  <div className="w-full max-w-96 space-y-5">
    {mails.map((mail, index) => (
      <RevealChild
        className="flex items-center gap-3"
        delay={index * 0.06}
        key={mail.sender}
      >
        <img
          alt=""
          className={cn("size-6 shrink-0 rounded object-contain", {
            invert: mail.sender === "Vercel",
          })}
          src={mail.icon}
        />
        <div className="min-w-0 flex-1">
          <p className="text-fg">{mail.sender}</p>
          <p className="truncate text-muted-fg">{mail.subject}</p>
        </div>
        <span
          className={cn("shrink-0 rounded-md px-2 py-1 text-fg", mail.tone)}
        >
          {mail.label}
        </span>
      </RevealChild>
    ))}
  </div>
);

const VoicePreview = () => (
  <RevealChild
    className="w-full max-w-96 space-y-4 rounded-xl bg-bg-raised/50 p-6 text-fg"
    delay={0.1}
  >
    <p className="text-muted-fg">To Alex</p>
    <p>Hey Alex,</p>
    <p>
      Great talking yesterday. Here are the ideas we discussed. Let me know what
      you think.
    </p>
  </RevealChild>
);

const BriefPreview = () => (
  <RevealChild className="w-full max-w-96 space-y-5" delay={0.1}>
    <p className="text-muted-fg">This morning</p>
    <div className="space-y-1">
      <p className="text-fg">The proposal is approved.</p>
      <p className="text-muted-fg">Alex is ready for the next steps.</p>
    </div>
    <div className="space-y-1">
      <p className="text-fg">Your trip is confirmed.</p>
      <p className="text-muted-fg">Your itinerary is in your inbox.</p>
    </div>
  </RevealChild>
);

const ChatPreview = () => (
  <div className="flex w-full max-w-96 flex-col gap-6">
    <RevealChild
      className="ml-6 self-end rounded-xl bg-bg-raised/50 px-4 py-3 text-fg"
      delay={0.08}
    >
      What did Alex say about the proposal?
    </RevealChild>
    <RevealChild className="mr-6 text-muted-fg" delay={0.16}>
      Alex approved it and asked for a timeline by Friday.
    </RevealChild>
  </div>
);

const FeaturePreview = ({
  children,
  title,
  description,
  id,
}: {
  children: ReactNode;
  title: string;
  description: string;
  id: string;
}) => (
  <section aria-labelledby={id} className="w-full max-w-xl px-6">
    <Reveal>
      <h2
        className="text-center text-2xl font-normal text-balance text-fg"
        id={id}
      >
        {title}
      </h2>
      <div
        aria-hidden
        className="flex min-h-64 items-center justify-center py-8 text-sm leading-relaxed"
      >
        {children}
      </div>
      <p className="text-center text-sm leading-relaxed text-balance text-muted-fg">
        {description}
      </p>
    </Reveal>
  </section>
);

export const AiSection = () => (
  <>
    <FeaturePreview
      id="home-labels-title"
      title="Automatic labels"
      description="Let AI organize your mail around your preferences."
    >
      <LabellingPreview />
    </FeaturePreview>
    <FeaturePreview
      id="home-drafts-title"
      title="Drafts in your voice"
      description="A head start on your reply. You review and send."
    >
      <VoicePreview />
    </FeaturePreview>
    <FeaturePreview
      id="home-brief-title"
      title="Your daily brief"
      description="The important parts of your inbox, in one place."
    >
      <BriefPreview />
    </FeaturePreview>
    <FeaturePreview
      id="home-chat-title"
      title="Chat with your mailbox"
      description="Find a detail or catch up on a conversation. AI is always optional."
    >
      <ChatPreview />
    </FeaturePreview>
  </>
);
