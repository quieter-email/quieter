"use client";

import { parseSender } from "@quieter/app/lib/gmail/message-utils";
import { getThreadWithDetailsOptions } from "@quieter/app/lib/mail/thread-query";
import type { ReminderTarget } from "@quieter/mail/reminders";
import { Surface } from "@quieter/ui/surface";
import { useQuery } from "@tanstack/react-query";

export const ReminderMailContext = ({
  mailboxId,
  target,
  layout = "inline",
}: {
  mailboxId: string;
  layout?: "inline" | "summary";
  target: Extract<ReminderTarget, { kind: "thread" }>;
}) => {
  const thread = useQuery(
    getThreadWithDetailsOptions(mailboxId, target.threadId)
  );
  const anchor = thread.data?.messages.find(
    (message) => message.id === target.anchorMessageId
  );
  const sender = anchor ? parseSender(anchor.from) : null;
  if (thread.isError) {
    if (layout === "inline") {
      return null;
    }
    return (
      <p className="text-caption text-muted-fg">
        Linked conversation is unavailable.
      </p>
    );
  }
  if (anchor === undefined) {
    if (layout === "inline") {
      return null;
    }
    return (
      <p className="text-caption text-muted-fg">
        {thread.isPending ? "Loading linked mail…" : "Linked conversation"}
      </p>
    );
  }
  if (layout === "summary") {
    return (
      <Surface chrome="compact" padding="snug" variant="section">
        <div className="space-y-1.5">
          <p className="text-body-sm break-words">
            {sender?.name || sender?.email}
          </p>
          <p className="truncate text-caption text-muted-fg">
            {anchor.subject || "No subject"}
          </p>
        </div>
      </Surface>
    );
  }
  return (
    <p className="truncate text-caption text-muted-fg">
      {sender?.name || sender?.email}
      {", "}
      {anchor.subject || "No subject"}
    </p>
  );
};
