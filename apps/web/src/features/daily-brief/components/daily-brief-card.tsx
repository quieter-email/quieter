"use client";

import type { DailyBriefItem } from "@quieter/mail/daily-brief";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@quieter/ui/popover";
import { Textarea } from "@quieter/ui/textarea";
import { useId, useState } from "react";

import type { UnifiedInboxMailbox } from "#/features/mailbox/domain/unified-inbox";

export const DailyBriefCard = ({
  item,
  mailbox,
  compact,
  busy,
  onOpenSource,
  onFeedback,
  onPrepareDraft,
}: {
  item: DailyBriefItem;
  mailbox: UnifiedInboxMailbox;
  compact: boolean;
  busy: boolean;
  onOpenSource: (
    mailboxId: string,
    messageId: string,
    threadId: string
  ) => void;
  onFeedback: (
    action: "dismiss" | "not_important" | "defer",
    preference?: string
  ) => void;
  onPrepareDraft: () => void;
}) => {
  const preferenceId = useId();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <article
      className={cn("border-b border-border last:border-b-0", {
        "py-4": compact,
        "py-8 sm:py-10": !compact,
      })}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-fg">
        <span>{mailbox.displayName || mailbox.emailAddress}</span>
        <span className="border-l border-border pl-3">{item.group}</span>
      </div>
      <h2
        className={cn("mt-2 font-medium tracking-tight text-fg", {
          "text-body-lg": compact,
          "text-xl sm:text-2xl": !compact,
        })}
      >
        {item.title}
      </h2>
      <p className="mt-3 max-w-2xl text-body leading-relaxed text-fg">
        {item.summary}
      </p>
      <p className="mt-3 text-caption leading-relaxed text-muted-fg">
        Why it matters: {item.reason}
      </p>
      <nav aria-label="Source mail" className="mt-4 flex flex-wrap gap-2">
        {item.sources.map((source) => (
          <Button
            className="max-w-full"
            key={source.messageId}
            onClick={() => {
              onOpenSource(mailbox.id, source.messageId, source.threadId);
            }}
            size="sm"
            variant="secondary"
          >
            <span className="truncate">
              Open {source.subject || "source mail"}
            </span>
          </Button>
        ))}
      </nav>
      <div className="mt-3 flex flex-wrap items-center gap-1">
        {mailbox.grantRole === "reader" ? null : (
          <Button
            disabled={busy}
            onClick={onPrepareDraft}
            size="sm"
            variant="ghost"
          >
            Prepare a draft
          </Button>
        )}
        <Button
          disabled={busy}
          onClick={() => {
            onFeedback("dismiss");
          }}
          size="sm"
          variant="ghost"
        >
          Dismiss
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            onFeedback("defer");
          }}
          size="sm"
          variant="ghost"
        >
          In one hour
        </Button>
        <Popover onOpenChange={setFeedbackOpen} open={feedbackOpen}>
          <PopoverTrigger
            render={<Button disabled={busy} size="sm" variant="ghost" />}
          >
            Not important
          </PopoverTrigger>
          <PopoverContent>
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                const preference = new FormData(event.currentTarget).get(
                  "preference"
                );
                onFeedback(
                  "not_important",
                  typeof preference === "string" ? preference.trim() : undefined
                );
                setFeedbackOpen(false);
              }}
            >
              <label className="text-body font-medium" htmlFor={preferenceId}>
                What should future briefs focus on?
              </label>
              <Textarea
                id={preferenceId}
                maxLength={1000}
                name="preference"
                placeholder="Optional, for this inbox only"
                rows={3}
              />
              <p className="text-caption text-muted-fg">
                This item stays out of future briefs. Your original mail stays
                in your inbox.
              </p>
              <Button disabled={busy} size="sm" type="submit">
                Mark not important
              </Button>
            </form>
          </PopoverContent>
        </Popover>
      </div>
    </article>
  );
};
