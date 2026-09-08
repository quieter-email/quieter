"use client";

import {
  ArrowRight01Icon,
  Mail01Icon,
  Search01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Brand } from "@quieter/ui/brand";
import { cn } from "@quieter/ui/cn";

const messages = [
  {
    label: "Projects",
    sender: "Alex Morgan",
    subject: "A few thoughts on the proposal",
    time: "09:41",
    tone: "bg-q-blue/10 text-q-blue",
  },
  {
    label: "Receipts",
    sender: "Stripe",
    subject: "Your monthly invoice",
    time: "09:12",
    tone: "bg-q-orange/10 text-q-orange",
  },
  {
    label: "Personal",
    sender: "Leander",
    subject: "Photos from Tokyo",
    time: "08:56",
    tone: "bg-q-pink/10 text-q-pink",
  },
  {
    label: "Work",
    sender: "Vercel",
    subject: "Your deployment is ready",
    time: "08:30",
    tone: "bg-q-cyan/10 text-q-cyan",
  },
  {
    label: "Personal",
    sender: "Sam Rivera",
    subject: "Coffee next week?",
    time: "Yesterday",
    tone: "bg-q-pink/10 text-q-pink",
  },
] as const;

export const MailboxPreview = ({
  accounts,
  labels = false,
}: {
  accounts: readonly string[];
  labels?: boolean;
}) => (
  <div className="home-product-preview overflow-hidden rounded-xl bg-bg/95 text-left text-sm text-muted-fg ring-1 ring-fg/10">
    <div className="flex h-12 items-center gap-3 border-b border-fg/5 px-5">
      <Brand className="h-5 w-20 text-fg" variant="combination" />
      <span className="ml-4 hidden text-muted-fg/50 sm:block">/</span>
      <span className="hidden sm:block">Inbox</span>
      <HugeiconsIcon className="ml-auto size-4" icon={Search01Icon} />
    </div>
    <div className="grid min-h-96 grid-cols-1 md:grid-cols-[160px_minmax(0,1fr)] lg:grid-cols-[180px_minmax(0,1fr)_300px]">
      <div className="hidden border-r border-fg/5 p-4 md:block">
        <div className="mb-6 flex items-center gap-2 rounded-md bg-fg/5 px-3 py-2 text-fg">
          <HugeiconsIcon className="size-4" icon={Mail01Icon} />
          Inbox<span className="ml-auto text-muted-fg">5</span>
        </div>
        <div className="space-y-4 px-3">
          <p>Starred</p>
          <p>Sent</p>
          <p>Drafts</p>
        </div>
        <div className="mt-10 space-y-4 px-3">
          {accounts.map((account, index) => (
            <p className="flex items-center gap-2 truncate" key={account}>
              <span
                className={cn("size-1.5 shrink-0 rounded-full", {
                  "bg-q-blue": index === 0,
                  "bg-q-green": index === 2,
                  "bg-q-pink": index === 1,
                })}
              />
              {account}
            </p>
          ))}
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex h-12 items-center justify-between px-5">
          <span className="text-fg">
            {labels ? "Organized for you" : "Inbox"}
          </span>
          <span>5 messages</span>
        </div>
        {messages.map((message, index) => (
          <div
            className={cn("space-y-1 px-5 py-3.5", { "bg-fg/5": index === 0 })}
            key={message.sender}
          >
            <div className="flex items-center gap-3">
              <span className="truncate text-fg">{message.sender}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-fg/70">
                {message.time}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <p className="min-w-0 flex-1 truncate">{message.subject}</p>
              {labels ? (
                <span
                  className={cn(
                    "shrink-0 rounded px-2 py-0.5 text-xs",
                    message.tone
                  )}
                >
                  {message.label}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <div className="hidden border-l border-fg/5 px-6 py-6 lg:block">
        <div className="mb-7 flex gap-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-q-blue/15 text-q-blue">
            A
          </span>
          <div>
            <p className="text-fg">Alex Morgan</p>
            <p className="text-xs">To you</p>
          </div>
        </div>
        <p className="mb-6 text-fg">A few thoughts on the proposal</p>
        <div className="space-y-4 leading-relaxed">
          <p>Hey,</p>
          <p>
            The direction looks great. The simpler layout feels like the right
            move.
          </p>
          <p>
            Could you send over a timeline by Friday? We can go through it
            together next week.
          </p>
          <p>
            Thanks,
            <br />
            Alex
          </p>
        </div>
        <div className="mt-7 flex items-center gap-2 text-fg">
          <HugeiconsIcon className="size-4" icon={ArrowRight01Icon} />
          Reply
        </div>
      </div>
    </div>
  </div>
);

export const ComposePreview = () => (
  <div className="home-product-preview grid overflow-hidden rounded-xl bg-bg/95 text-left text-sm text-muted-fg ring-1 ring-fg/10 md:grid-cols-[0.8fr_1.2fr]">
    <div className="hidden p-8 md:block lg:p-10">
      <div className="mb-8 flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-full bg-q-blue/15 text-q-blue">
          A
        </span>
        <div>
          <p className="text-fg">Alex Morgan</p>
          <p className="text-xs">Today, 09:41</p>
        </div>
      </div>
      <p className="mb-5 text-fg">A few thoughts on the proposal</p>
      <div className="space-y-5 leading-relaxed">
        <p>
          The direction looks great. The simpler layout feels like the right
          move.
        </p>
        <p>
          Could you send over a timeline by Friday? We can go through it
          together next week.
        </p>
      </div>
    </div>
    <div className="bg-bg-raised/50">
      <div className="flex items-center justify-between border-b border-fg/5 px-6 py-4">
        <span className="text-fg">Reply to Alex</span>
        <span className="text-xs">Draft</span>
      </div>
      <div className="space-y-5 px-6 py-7 leading-relaxed sm:px-10">
        <p className="text-fg">Hey Alex,</p>
        <p className="text-fg">
          Glad the direction feels right. I can get a timeline over to you by
          Friday.
        </p>
        <p className="text-fg">
          Next week works for me. How does Tuesday afternoon look?
        </p>
        <p className="text-fg">Talk soon!</p>
        <div className="flex items-center gap-2 pt-4 text-muted-fg">
          <HugeiconsIcon className="size-4" icon={SparklesIcon} />
          Drafted in your voice
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 px-6 pb-6 sm:px-10">
        <span className="shrink-0 rounded-md bg-fg px-4 py-2 text-bg">
          Send reply
        </span>
        <span className="text-right text-xs">You have the final say</span>
      </div>
    </div>
  </div>
);

export const AssistantPreview = () => (
  <div className="home-product-preview grid overflow-hidden rounded-xl bg-bg/95 text-left text-sm text-muted-fg ring-1 ring-fg/10 md:grid-cols-2">
    <div className="p-6 sm:p-9">
      <div className="mb-8 flex items-center gap-2 text-fg">
        <Brand className="size-4" />
        Your daily brief
      </div>
      <p className="mb-7 text-fg">Good morning. Here is what matters.</p>
      <div className="space-y-6">
        <div>
          <p className="mb-2 text-fg">The proposal is approved</p>
          <p>Alex is ready to move forward. Send a timeline by Friday.</p>
        </div>
        <div>
          <p className="mb-2 text-fg">Your trip is confirmed</p>
          <p>Flights and hotel details are in your inbox.</p>
        </div>
        <div className="hidden sm:block">
          <p className="mb-2 text-fg">A quieter afternoon</p>
          <p>The rest can wait. You are caught up.</p>
        </div>
      </div>
    </div>
    <div className="flex flex-col bg-bg-raised/40 p-6 sm:p-9">
      <div className="mb-7 flex items-center gap-2 text-fg">
        <HugeiconsIcon className="size-4" icon={SparklesIcon} />
        Chat with your mailbox
      </div>
      <p className="ml-6 self-end rounded-xl bg-fg/5 px-4 py-3 text-fg">
        What did Alex say about the proposal?
      </p>
      <p className="mt-6 leading-relaxed">
        Alex approved the direction and asked for a timeline by Friday. He would
        like to meet next week.
      </p>
      <div className="mt-5 flex items-center gap-2 text-fg">
        <HugeiconsIcon className="size-4" icon={Mail01Icon} />A few thoughts on
        the proposal
      </div>
      <div className="mt-8 flex items-center justify-between rounded-lg bg-bg/70 px-4 py-3 md:mt-auto">
        <span>Ask a follow-up...</span>
        <HugeiconsIcon className="size-4" icon={ArrowRight01Icon} />
      </div>
    </div>
  </div>
);

export const WorkflowPreview = () => (
  <div className="home-product-preview relative flex min-h-80 items-center justify-center overflow-hidden rounded-xl bg-bg/70 p-5 sm:p-10">
    <div
      className="absolute inset-0 grid grid-cols-2 gap-8 p-10 text-sm text-muted-fg/30 sm:px-20"
      aria-hidden
    >
      <div className="space-y-5">
        <p>Inbox</p>
        <p>Alex Morgan</p>
        <p>Stripe</p>
        <p>Leander</p>
        <p>Sam Rivera</p>
      </div>
      <div className="space-y-5">
        <p>Templates</p>
        <p>Thanks for reaching out</p>
        <p>A quick follow-up</p>
        <p>Getting started</p>
      </div>
    </div>
    <div className="relative w-full max-w-lg overflow-hidden rounded-xl bg-bg-raised shadow-2xl ring-1 ring-fg/10">
      <div className="flex items-center gap-3 border-b border-fg/5 px-5 py-4 text-sm text-muted-fg">
        <HugeiconsIcon className="size-4" icon={Search01Icon} />
        Keyboard shortcuts<span className="ml-auto text-xs">Esc</span>
      </div>
      <div className="p-2 text-sm text-muted-fg">
        {[
          { key: "C", label: "Compose a message" },
          { key: "Ctrl K", label: "Find a message" },
          { key: "G I", label: "Go to inbox" },
          { key: "G H", label: "Open chat" },
        ].map((action, index) => (
          <div
            className={cn(
              "flex items-center justify-between rounded-md px-3 py-3",
              { "bg-fg/5 text-fg": index === 0 }
            )}
            key={action.label}
          >
            <span>{action.label}</span>
            <span className="text-xs">{action.key}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
);
