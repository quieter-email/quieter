"use client";

import { Tag01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@quieter/ui";
import type { GmailLabelListItem } from "~/lib/gmail/gmail";

type MessageLabelsProps = {
  className?: string;
  compact?: boolean;
  labelIds?: string[];
  labels: GmailLabelListItem[];
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
      aria-label="Gmail labels"
      className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}
    >
      {visibleLabels.map((label) => (
        <span
          className={cn(
            "squircle inline-flex min-w-0 items-center rounded-md border border-border/60 bg-muted/50 font-medium text-muted-foreground",
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
