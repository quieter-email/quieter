import { ORPCError } from "@orpc/server";
import {
  getMailboxSyncDelta,
  getMessageAttachment,
  getMessageInspector,
  getThreadWithDetails,
  listDraftsWithDetails,
  listMessagesWithDetails,
} from "@quieter/gmail";

import { callGmail } from "../gmail-request";
import type { MailRequestContext } from "../gmail-request";
import { assertUserOrganizationMember } from "../mail-domain/service";
import { assertAccessibleMailbox } from "../mailbox/service";
import { getManagedMessageAttachment } from "../managed-mail/messages/attachments";
import {
  getManagedMessageDelivery,
  getManagedMessageInspector,
  getManagedThread,
  listManagedMessageDeliveryStatuses,
  listManagedMessages,
} from "../managed-mail/messages/service";
import {
  getOrganizationApiMailInspector,
  getOrganizationApiMailDelivery,
  getOrganizationApiMailThread,
  isOrganizationApiMailboxId,
  listOrganizationApiMailDeliveryStatuses,
  listOrganizationApiMailMessages,
  parseOrganizationApiMailboxId,
} from "../organization-api-mail";
import type { MailInputs } from "./inputs";

export const queriesMailOperations = {
  getAttachment: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["getAttachment"];
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      return await getManagedMessageAttachment({
        ...input,
        userId: context.userId,
      });
    }
    return await callGmail(
      context,
      input.mailboxId,
      async (accessToken, signal) => {
        const attachment = await getMessageAttachment(
          accessToken,
          input.messageId,
          input.attachmentId,
          signal
        );
        const attachmentData = attachment.data;
        const bytes = attachmentData
          ? Uint8Array.from(
              atob(attachmentData.replaceAll("-", "+").replaceAll("_", "/")),
              (char) => char.codePointAt(0) ?? 0
            )
          : new Uint8Array();

        return {
          attachmentId: attachment.attachmentId ?? input.attachmentId,
          file: new File([bytes], input.fileName, {
            lastModified: Date.now(),
            type: input.mimeType,
          }),
          size: attachment.size ?? bytes.byteLength,
        };
      }
    );
  },
  getMessageDelivery: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["getMessageDelivery"];
  }) => {
    if (isOrganizationApiMailboxId(input.mailboxId)) {
      return await getOrganizationApiMailDelivery({
        ...input,
        userId: context.userId,
      });
    }

    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider !== "managed") {
      return null;
    }
    return await getManagedMessageDelivery({
      ...input,
      userId: context.userId,
    });
  },
  getMessageInspector: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["getMessageInspector"];
  }) => {
    if (isOrganizationApiMailboxId(input.mailboxId)) {
      return await getOrganizationApiMailInspector({
        ...input,
        userId: context.userId,
      });
    }

    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      return await getManagedMessageInspector({
        ...input,
        userId: context.userId,
      });
    }

    return await callGmail(
      context,
      input.mailboxId,
      async (accessToken, signal) =>
        await getMessageInspector(accessToken, input.messageId, signal)
    );
  },
  getThread: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["getThread"];
  }) => {
    if (isOrganizationApiMailboxId(input.mailboxId)) {
      return await getOrganizationApiMailThread({
        ...input,
        userId: context.userId,
      });
    }

    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      return await getManagedThread({
        ...input,
        userId: context.userId,
      });
    }

    return await callGmail(
      context,
      input.mailboxId,
      async (accessToken, signal) =>
        await getThreadWithDetails(accessToken, input.threadId, signal)
    );
  },
  listMessageDeliveryStatuses: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["listMessageDeliveryStatuses"];
  }) => {
    if (isOrganizationApiMailboxId(input.mailboxId)) {
      return await listOrganizationApiMailDeliveryStatuses({
        ...input,
        userId: context.userId,
      });
    }

    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider !== "managed") {
      return {};
    }
    return await listManagedMessageDeliveryStatuses({
      ...input,
      userId: context.userId,
    });
  },
  listThreads: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["listThreads"];
  }) => {
    if (isOrganizationApiMailboxId(input.mailboxId)) {
      return await listOrganizationApiMailMessages({
        ...input,
        userId: context.userId,
      });
    }

    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      return await listManagedMessages({
        ...input,
        userId: context.userId,
      });
    }

    return await callGmail(
      context,
      input.mailboxId,
      async (accessToken, signal) =>
        input.category === "drafts"
          ? await listDraftsWithDetails(accessToken, {
              maxResults: input.maxResults,
              pageToken: input.pageToken,
              query: input.query?.trim() || undefined,
              signal,
            })
          : await listMessagesWithDetails(accessToken, {
              mailbox: input.category,
              maxResults: input.maxResults,
              pageToken: input.pageToken,
              query: input.query?.trim() || undefined,
              signal,
            })
    );
  },
  syncMailbox: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["syncMailbox"];
  }) => {
    if (isOrganizationApiMailboxId(input.mailboxId)) {
      const organizationId = parseOrganizationApiMailboxId(input.mailboxId);
      if (organizationId === null || organizationId.length === 0) {
        throw new ORPCError("NOT_FOUND", {
          message: "API mailbox not found.",
        });
      }
      await assertUserOrganizationMember({
        organizationId,
        userId: context.userId,
      });
      return {
        hasChanges: true,
        refreshFirstPage: true,
        removedMessageIds: [],
        requiresFullRefresh: true,
        updatedMessages: [],
      };
    }

    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      const historyId = String(selectedMailbox.contentRevision);
      const hasChanges = historyId !== input.startHistoryId;
      return {
        hasChanges,
        historyId,
        refreshFirstPage: hasChanges,
        removedMessageIds: [],
        requiresFullRefresh: hasChanges,
        updatedMessages: [],
      };
    }

    return await callGmail(
      context,
      input.mailboxId,
      async (accessToken, signal) =>
        await getMailboxSyncDelta(accessToken, {
          mailbox: input.category,
          signal,
          startHistoryId: input.startHistoryId,
        })
    );
  },
};
