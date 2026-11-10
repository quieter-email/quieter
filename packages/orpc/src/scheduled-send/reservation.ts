import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  gmailComposeOperation,
  scheduledMailSend,
} from "@quieter/database/schema";
import { and, eq, inArray, or } from "drizzle-orm";

export const resolveComposeSourceDraftId = async (input: {
  provider: "gmail" | "managed";
  mailboxId: string;
  localId: string;
  draftId?: string | null;
}) => {
  if (input.draftId) {
    return input.draftId;
  }
  if (input.provider === "managed") {
    return `draft:${input.localId}`;
  }
  const [created] = await db
    .select({ response: gmailComposeOperation.response })
    .from(gmailComposeOperation)
    .where(
      and(
        eq(gmailComposeOperation.mailboxId, input.mailboxId),
        eq(gmailComposeOperation.kind, "save"),
        eq(gmailComposeOperation.operationKey, `save:create:${input.localId}`),
        eq(gmailComposeOperation.status, "accepted")
      )
    )
    .limit(1);
  return created?.response?.id ?? null;
};

export const assertComposeNotScheduled = async (input: {
  mailboxId: string;
  localId: string;
  draftId?: string | null;
  sendOperationId?: string;
  scheduledSendId?: string;
}) => {
  const [reserved] = await db
    .select({ id: scheduledMailSend.id })
    .from(scheduledMailSend)
    .where(
      and(
        eq(scheduledMailSend.mailboxId, input.mailboxId),
        inArray(scheduledMailSend.status, [
          "preparing",
          "scheduled",
          "sending",
          "failed",
          "uncertain",
        ]),
        or(
          eq(scheduledMailSend.sourceLocalId, input.localId),
          input.draftId
            ? eq(scheduledMailSend.sourceDraftId, input.draftId)
            : undefined,
          input.sendOperationId
            ? eq(scheduledMailSend.sendOperationId, input.sendOperationId)
            : undefined
        )
      )
    )
    .limit(1);
  if (reserved !== undefined && reserved.id !== input.scheduledSendId) {
    throw new ORPCError("CONFLICT", {
      data: { scheduledSendConflict: true },
      message:
        "This message is scheduled. Cancel its scheduled send before editing or sending it.",
    });
  }
};
