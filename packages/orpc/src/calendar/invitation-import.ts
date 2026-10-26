import { createHash } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { getMessageAttachment } from "@quieter/gmail";

import { parseIcsToGoogleCalendarEvent } from "../connectors/ical";
import { runAuthorizedGmailMailbox } from "../gmail-mailbox-access";
import { assertAccessibleMailbox } from "../mailbox/service";
import { getManagedMessageAttachment } from "../managed-mail/messages/attachments";
import {
  importCalendarInvitationForUser,
  resolveCalendarImportTargetForUser,
} from "./service";

export const importCalendarInvitationAttachmentForUser = async (input: {
  attachmentId: string;
  calendarId?: string;
  connectionId?: string;
  mailboxId: string;
  messageId: string;
  signal?: AbortSignal;
  userId: string;
}) => {
  const target = await resolveCalendarImportTargetForUser(input);
  const mailbox = await assertAccessibleMailbox(input);
  let invitation: string;
  if (mailbox.provider === "managed") {
    const attachment = await getManagedMessageAttachment(input);
    invitation = await attachment.file.text();
  } else {
    const attachment = await runAuthorizedGmailMailbox(
      { mailboxId: input.mailboxId, userId: input.userId },
      async (accessToken) =>
        await getMessageAttachment(
          accessToken,
          input.messageId,
          input.attachmentId,
          input.signal
        )
    );
    invitation = Buffer.from(attachment.data ?? "", "base64url").toString(
      "utf-8"
    );
  }
  if (invitation.trim() === "") {
    throw new ORPCError("BAD_REQUEST", {
      message: "This calendar invitation could not be read.",
    });
  }

  const parsedEvent = (() => {
    try {
      return parseIcsToGoogleCalendarEvent(invitation);
    } catch {
      throw new ORPCError("BAD_REQUEST", {
        message: "This calendar invitation could not be imported.",
      });
    }
  })();
  return await importCalendarInvitationForUser({
    ...target,
    event: parsedEvent,
    fallbackUid: `${createHash("sha256")
      .update(
        JSON.stringify([
          input.userId,
          input.mailboxId,
          input.messageId,
          input.attachmentId,
        ])
      )
      .digest("hex")}@quieter.email`,
    signal: input.signal,
    userId: input.userId,
  });
};
