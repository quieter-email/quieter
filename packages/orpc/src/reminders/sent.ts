import { ORPCError } from "@orpc/server";
import { createReminderSchema } from "@quieter/mail/reminders";
import type { FollowUpReminderIntent } from "@quieter/mail/reminders";

import { publishMailUpdate } from "../mail-updates";
import { assertAccessibleMailbox } from "../mailbox/service";
import { createReminderRecord } from "./persistence";
import { requestReminderWake } from "./wake";

export const materializeSentReminder = async (input: {
  userId: string;
  mailboxId: string;
  messageId: string;
  threadId: string;
  intent: FollowUpReminderIntent;
}) => {
  let suspended = false;
  try {
    await assertAccessibleMailbox(input);
  } catch (error) {
    if (
      !(error instanceof ORPCError) ||
      (error.code !== "NOT_FOUND" && error.code !== "FORBIDDEN")
    ) {
      throw error;
    }
    suspended = true;
  }
  const value = createReminderSchema.parse({
    dueAt: input.intent.dueAt,
    mailboxId: input.mailboxId,
    requestId: input.intent.requestId,
    target: {
      anchorMessageId: input.messageId,
      condition: input.intent.condition,
      kind: "thread",
      threadId: input.threadId,
    },
    timeZone: input.intent.timeZone,
    title: input.intent.title,
  });
  const row = await createReminderRecord({
    ...value,
    suspended,
    userId: input.userId,
  });
  if (!suspended) {
    await requestReminderWake(input);
    await publishMailUpdate(
      {
        mailboxId: row.mailboxId,
        reminderId: row.id,
        scheduleVersion: row.scheduleVersion,
        type: "reminders.changed",
      },
      { recipientUserIds: [input.userId] }
    );
  }
  return row;
};
