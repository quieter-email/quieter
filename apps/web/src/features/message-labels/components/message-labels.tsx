"use client";

import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { Tag01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@quieter/ui/cn";

type MessageLabelsProps = {
  className?: string;
  compact?: boolean;
  labelIds?: string[];
  labels: MailboxLabel[];
  limit?: number;
};

const labelColorClassNames = {
  blue: "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  cyan: "border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  gray: "border-border/60 bg-muted/50 text-muted-foreground",
  green: "border-green-500/25 bg-green-500/10 text-green-700 dark:text-green-300",
  orange: "border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  pink: "border-pink-500/25 bg-pink-500/10 text-pink-700 dark:text-pink-300",
  purple: "border-purple-500/25 bg-purple-500/10 text-purple-700 dark:text-purple-300",
  red: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
  yellow: "border-yellow-500/25 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
} as const;

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
        <span
          className={cn(
            "inline-flex min-w-0 items-center rounded-md border font-medium squircle",
            labelColorClassNames[label.color ?? "gray"],
            {
              "h-4 max-w-24 px-1.5 text-[10px]": compact,
              "h-5 max-w-44 gap-1 px-1.5 text-[11px]": !compact,
            },
          )}
          key={label.id}
          title={label.name}
        >
          {!compact && <HugeiconsIcon aria-hidden className="size-3 shrink-0" icon={Tag01Icon} />}
          <span className="truncate">{label.name}</span>
        </span>
      ))}
      {hiddenLabels.length > 0 && (
        <span
          className={cn("shrink-0 text-muted-foreground", {
            "text-[10px]": compact,
            "text-[11px]": !compact,
          })}
          title={hiddenLabels.map((label) => label.name).join(", ")}
        >
          +{hiddenLabels.length}
        </span>
      )}
    </div>
  );
};
