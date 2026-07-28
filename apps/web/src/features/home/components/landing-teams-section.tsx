"use client";

import { cn } from "@quieter/ui/cn";
import { m, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Reveal, SectionIntro } from "./landing-shared";

const mailboxes = [
  { active: true, count: 12, name: "support@" },
  { active: false, count: 4, name: "billing@" },
  { active: false, count: 1, name: "press@" },
] as const;

const conversations = [
  {
    assignee: { className: "bg-label-purple-solid/20 text-label-purple-solid", initials: "NR" },
    chip: { className: "bg-label-orange-solid/12 text-label-orange-solid", name: "Urgent" },
    preview: "Checkout fails on the confirmation step since this morning.",
    sender: "Atlas Coffee",
    time: "11:20",
  },
  {
    assignee: { className: "bg-label-blue-solid/20 text-label-blue-solid", initials: "MK" },
    chip: null,
    preview: "Could you resend the receipt for order 4417?",
    sender: "June Park",
    time: "10:48",
  },
  {
    assignee: null,
    chip: { className: "bg-label-green-solid/12 text-label-green-solid", name: "Feature" },
    preview: "Any plans for a dark exports option this quarter?",
    sender: "Otto Lang",
    time: "10:05",
  },
] as const;

const members = [
  { name: "Nova, manager", role: "Owns labels, views, and rules" },
  { name: "Milo, responder", role: "Replies and applies labels" },
  { name: "June, reader", role: "Browses and follows threads" },
] as const;

const TeamsVisual = () => (
  <div className="overflow-hidden rounded-xl border border-white/8 bg-[oklch(0.168_0.002_264)] shadow-[0_32px_80px_-24px_oklch(0_0_0/0.6)] squircle">
    <div className="grid md:grid-cols-[180px_1fr]">
      <div className="hidden border-r border-white/6 py-3 md:block">
        <p className="px-4 pb-2 font-mono text-[10px] tracking-[0.16em] text-muted-foreground/50 uppercase">
          Shared
        </p>
        {mailboxes.map((mailbox) => (
          <div
            className={cn(
              "mx-2 flex items-center justify-between rounded-md px-2 py-1.5 squircle",
              {
                "bg-white/5 text-foreground": mailbox.active,
                "text-muted-foreground": !mailbox.active,
              },
            )}
            key={mailbox.name}
          >
            <span className="text-[13px]">{mailbox.name}</span>
            <span className="text-xs text-muted-foreground/60 tabular-nums">{mailbox.count}</span>
          </div>
        ))}
      </div>

      <div>
        <div className="flex items-center gap-2.5 border-b border-white/6 px-5 py-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/90">support@yourdomain.com</span>
          <span className="ml-auto text-muted-foreground/50">3 open</span>
        </div>
        {conversations.map((conversation, index) => (
          <div
            className={cn("flex items-center gap-4 px-5 py-3.5", {
              "border-b border-white/5": index < conversations.length - 1,
            })}
            key={conversation.sender}
          >
            <span className="w-28 shrink-0 truncate text-[13px] text-foreground/85">
              {conversation.sender}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground/60">
              {conversation.preview}
            </span>
            {conversation.chip ? (
              <span
                className={cn(
                  "hidden shrink-0 rounded-md px-1.5 py-0.5 text-[10px] squircle sm:inline",
                  conversation.chip.className,
                )}
              >
                {conversation.chip.name}
              </span>
            ) : null}
            {conversation.assignee ? (
              <span
                className={cn(
                  "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-medium",
                  conversation.assignee.className,
                )}
              >
                {conversation.assignee.initials}
              </span>
            ) : (
              <span
                aria-hidden
                className="size-5 shrink-0 rounded-full border border-dashed border-white/15"
              />
            )}
            <span className="hidden shrink-0 text-xs text-muted-foreground/50 tabular-nums sm:inline">
              {conversation.time}
            </span>
          </div>
        ))}
        <div className="flex flex-wrap gap-x-8 gap-y-2 border-t border-white/6 px-5 py-3.5">
          {members.map((member) => (
            <p className="text-xs" key={member.name}>
              <span className="text-foreground/80">{member.name}</span>
              <span className="ml-2 hidden text-muted-foreground/50 lg:inline">{member.role}</span>
            </p>
          ))}
        </div>
      </div>
    </div>
  </div>
);

const draftText =
  "Hi Atlas team, thanks for flagging this so quickly. We traced the checkout failure to this morning's release and rolled it back at 11:32. Orders placed during the window were not charged twice.";

const TypewriterDraft = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const inView = useInView(containerRef, { amount: 0.6, once: true });
  const reducedMotion = useReducedMotion();
  const [visibleChars, setVisibleChars] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reducedMotion) {
      setVisibleChars(draftText.length);
      return;
    }

    const interval = window.setInterval(() => {
      setVisibleChars((previous) => {
        if (previous >= draftText.length) {
          window.clearInterval(interval);
          return previous;
        }
        return previous + 2;
      });
    }, 24);

    return () => window.clearInterval(interval);
  }, [inView, reducedMotion]);

  return (
    <div
      className="overflow-hidden rounded-xl border border-white/8 bg-[oklch(0.168_0.002_264)] shadow-[0_32px_80px_-24px_oklch(0_0_0/0.6)] squircle"
      ref={containerRef}
    >
      <div className="flex items-center gap-2.5 border-b border-white/6 px-5 py-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground/90">Draft reply</span>
        <span className="text-muted-foreground/50">Atlas Coffee</span>
      </div>
      <div className="min-h-40 px-5 py-4">
        <p className="text-[13px]/6 text-foreground/85">
          {draftText.slice(0, visibleChars)}
          {visibleChars < draftText.length ? (
            <span
              aria-hidden
              className="landing-caret ml-px inline-block h-3.5 w-px translate-y-0.5 bg-foreground/80"
            />
          ) : null}
        </p>
      </div>
      <m.div
        animate={visibleChars >= draftText.length ? { opacity: 1 } : { opacity: 0 }}
        className="flex items-center justify-between border-t border-white/6 px-5 py-3"
        initial={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
      >
        <p className="text-xs text-muted-foreground/60">Yours to edit before anything sends</p>
        <span className="rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background squircle">
          Send
        </span>
      </m.div>
    </div>
  );
};

export const LandingTeamsSection = () => (
  <section className="scroll-mt-14 px-5 py-28 md:px-8 md:py-40" id="teams">
    <div className="mx-auto w-full max-w-6xl">
      <SectionIntro
        copy="Shared mailboxes on your domain, with labels, saved views, and rules the whole team can rely on. Managers shape the workflow, responders reply, readers stay informed."
        index="3.0"
        label="Teams"
        title={
          <>
            One inbox,
            <br />
            whole team
          </>
        }
      />
      <Reveal className="mt-14 md:mt-20" delay={0.1}>
        <TeamsVisual />
      </Reveal>
    </div>
  </section>
);

export const LandingAssistSection = () => (
  <section className="px-5 py-28 md:px-8 md:py-40">
    <div className="mx-auto grid w-full max-w-6xl items-center gap-12 md:grid-cols-2 md:gap-16">
      <div>
        <Reveal>
          <h2 className="max-w-md text-[1.9rem] leading-[1.12] font-normal tracking-tight text-foreground md:text-[2.35rem]">
            Drafts that sound
            <br />
            like you
          </h2>
        </Reveal>
        <Reveal delay={0.08}>
          <p className="mt-6 max-w-md text-[15px]/6.5 text-muted-foreground">
            Ask for a reply and get a draft grounded in the thread. It waits for your edits, and
            nothing sends until you decide it should.
          </p>
          <p className="mt-6 font-mono text-xs text-muted-foreground/60">
            <span className="text-muted-foreground/40">4.0</span>
            <span className="ml-3">Assist</span>
          </p>
        </Reveal>
      </div>
      <Reveal delay={0.12}>
        <TypewriterDraft />
      </Reveal>
    </div>
  </section>
);
