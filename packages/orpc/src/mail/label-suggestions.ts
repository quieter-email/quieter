import { db } from "@quieter/database/client";
import { gmailAutoLabelEvent } from "@quieter/database/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { assertAccessibleMailbox } from "../mailbox/service";

export const listLabelSuggestions = async (input: {
  mailboxId: string;
  messageIds: string[];
  userId: string;
}) => {
  await assertAccessibleMailbox(input);
  const results = await db
    .select({
      labelIds: gmailAutoLabelEvent.labelIds,
      messageId: gmailAutoLabelEvent.gmailMessageId,
      suggestedLabelIds: gmailAutoLabelEvent.suggestedLabelIds,
    })
    .from(gmailAutoLabelEvent)
    .where(
      and(
        eq(gmailAutoLabelEvent.mailboxId, input.mailboxId),
        inArray(gmailAutoLabelEvent.gmailMessageId, input.messageIds),
        isNotNull(gmailAutoLabelEvent.appliedAt)
      )
    );
  const byMessageId = new Map(
    results.map((result) => [result.messageId, result])
  );
  const ordered = input.messageIds.map((messageId) =>
    byMessageId.get(messageId)
  );
  return [
    ...new Set([
      ...ordered.flatMap((result) => result?.labelIds ?? []),
      ...ordered.flatMap((result) => result?.suggestedLabelIds ?? []),
    ]),
  ];
};
