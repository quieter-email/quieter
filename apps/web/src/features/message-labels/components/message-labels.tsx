"use client";

import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { cn } from "@quieter/ui/cn";
import { Pill } from "@quieter/ui/pill";
import { mailboxLabelPillToneByColor } from "~/features/message-labels/domain/mailbox-label-presentation";

type MessageLabelsProps = {
  className?: string;
  compact?: boolean;
  labelIds?: string[];
  labels: MailboxLabel[];
  limit?: number;
};

export const MessageLabels = ({
  className,
  compact = false,
  labelIds,
  labels,
  limit,
}: MessageLabelsProps) => {
  if (!labelIds?.length) return null;

  const messageLabelIds = new Set(labelIds);
  const messageLabels = labels.filter(
    (label) => label.type === "user" && messageLabelIds.has(label.id),
  );
  if (messageLabels.length === 0) return null;

  const visibleLabels = limit ? messageLabels.slice(0, limit) : messageLabels;
  const hiddenLabels = messageLabels.slice(visibleLabels.length);

  return (
    <div
      aria-label="Message labels"
      className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}
    >
      {visibleLabels.map((label) => (
        <Pill
          className={cn("min-w-0", {
            "max-w-24": compact,
            "max-w-44": !compact,
          })}
          key={label.id}
          size={compact ? "xs" : "sm"}
          title={label.name}
          tone={mailboxLabelPillToneByColor[label.color ?? "gray"]}
        >
          <span className="truncate">{label.name}</span>
        </Pill>
      ))}
      {hiddenLabels.length > 0 && (
        <Pill
          className="shrink-0"
          size={compact ? "xs" : "sm"}
          title={hiddenLabels.map((label) => label.name).join(", ")}
          tone="gray"
        >
          +{hiddenLabels.length}
        </Pill>
      )}
    </div>
  );
};
