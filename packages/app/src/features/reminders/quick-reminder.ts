import { toastError } from "@quieter/app/lib/error-toast";
import type { MessageListItem } from "@quieter/app/lib/mail";
import {
  isGmailSandboxMailboxId,
  isManagedSandboxMailboxId,
} from "@quieter/app/lib/sandbox-mailbox";
import type { ChangeReminder, CreateReminder } from "@quieter/mail/reminders";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import { cacheReminder } from "./reminder-mutations";
import {
  changeUiReminder,
  createUiReminder,
  reminderListOptions,
} from "./reminder-query";
import { getReminderPresetTime } from "./reminder-time";

export type QuickReminderPreset = "tomorrow" | "week" | "reply";

export const useQuickReminder = ({
  mailboxId,
  message,
}: {
  mailboxId: string;
  message: Pick<MessageListItem, "id" | "threadId" | "subject"> | null;
}) => {
  const queryClient = useQueryClient();
  const demo =
    isGmailSandboxMailboxId(mailboxId) || isManagedSandboxMailboxId(mailboxId);
  const attempts = useRef(new Map<string, CreateReminder>());
  return useMutation({
    mutationFn: async (preset: QuickReminderPreset) => {
      if (message === null) {
        throw new Error("The reminder message is unavailable.");
      }
      const key = JSON.stringify([demo, mailboxId, message.id, preset]);
      let input = attempts.current.get(key);
      if (input === undefined) {
        const { timeZone } = Intl.DateTimeFormat().resolvedOptions();
        input = {
          dueAt: getReminderPresetTime({
            days: preset === "tomorrow" ? 1 : 7,
            timeZone,
          }),
          mailboxId,
          requestId: crypto.randomUUID(),
          target: {
            anchorMessageId: message.id,
            condition:
              preset === "reply"
                ? "A participant other than me gives a substantive reply to this conversation after this message"
                : null,
            kind: "thread",
            threadId: message.threadId,
          },
          timeZone,
          title: message.subject || "Follow up",
        };
        attempts.current.set(key, input);
      }
      const active = await queryClient.query({
        ...reminderListOptions(mailboxId, "active", demo),
        staleTime: "static",
      });
      const existing = active.items.find(
        (item) =>
          item.status === "active" &&
          item.target.kind === "thread" &&
          item.target.threadId === message.threadId
      );
      if (existing && existing.target.kind === "thread") {
        const command =
          preset === "reply"
            ? ({
                dueAt: input.dueAt,
                kind: "edit",
                target: {
                  ...existing.target,
                  condition:
                    input.target.kind === "thread"
                      ? input.target.condition
                      : null,
                },
                timeZone: input.timeZone,
                title: existing.title,
              } satisfies ChangeReminder["command"])
            : ({
                dueAt: input.dueAt,
                kind: "snooze",
                timeZone: input.timeZone,
              } satisfies ChangeReminder["command"]);
        const reminder = await changeUiReminder(
          {
            command,
            expectedVersion: existing.version,
            mailboxId,
            reminderId: existing.id,
          },
          demo
        );
        return { key, reminder };
      }
      const reminder = await createUiReminder(input, demo);
      return { key, reminder };
    },
    onError: (error) => {
      toastError(error, {
        boundary: "quick-reminder",
        fallback: "Could not set the reminder. Please try again.",
      });
    },
    onSuccess: async ({ key, reminder }) => {
      attempts.current.delete(key);
      cacheReminder({ client: queryClient, demo, reminder });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["reminders", reminder.mailboxId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["reminder-suggestion", reminder.mailboxId],
        }),
      ]);
    },
  });
};
