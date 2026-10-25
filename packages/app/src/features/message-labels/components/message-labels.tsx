"use client";

import { mailboxLabelPillToneByColor } from "@quieter/app/features/message-labels/domain/mailbox-label-presentation";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { cn } from "@quieter/ui/cn";
import { Pill } from "@quieter/ui/pill";

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
  if ((labelIds?.length ?? 0) === 0) {
    return null;
  }

  const messageLabelIds = new Set(labelIds);
  const messageLabels = labels.filter(
    (label) => label.type === "user" && messageLabelIds.has(label.id)
  );
  if (messageLabels.length === 0) {
    return null;
  }

  const visibleLabels =
    limit !== null && limit !== undefined && limit > 0
      ? messageLabels.slice(0, limit)
      : messageLabels;
  const hiddenLabels = messageLabels.slice(visibleLabels.length);

  return (
    <div
      aria-label="Conversation labels"
      className={cn(
        "flex min-w-0 items-center gap-1",
        { "flex-wrap": !compact },
        className
      )}
    >
      {visibleLabels.map((label) => (
        <Pill
          className={cn("min-w-0", {
            "max-w-24 shrink": compact,
            "max-w-44": !compact,
          })}
          key={label.id}
          customColor={
            label.color?.startsWith("#") === true ? label.color : undefined
          }
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
