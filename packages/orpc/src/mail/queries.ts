import { ORPCError } from "@orpc/server";
import {
  getMailboxSyncDelta,
  getMessageAttachment,
  getDraftWithContent,
  getMessageInspector,
  getThreadWithDetails,
  isGmailServiceError,
  listDraftsWithDetails,
  listMessagesWithDetails,
  listLabels,
} from "@quieter/gmail";
import { parseDraftMessage } from "@quieter/gmail/compose";
import type { MailboxSyncDelta } from "@quieter/mail/messages";
import type { MailSearchFilter } from "@quieter/mail/search";
import type { MailSearchExpression } from "@quieter/mail/search-expression";

import {
  captureMailboxDraftMemory,
  captureMailboxMessageMemory,
  queueMailboxMessageMemory,
} from "../ai-memory-capture";
import { hydrateUnsubscribeStatus } from "../gmail-compose";
import { callGmail } from "../gmail-request";
import type { MailRequestContext } from "../gmail-request";
import { writeGmailCapturedMessage } from "../mail-capture";
import { assertUserOrganizationMember } from "../mail-domain/service";
import {
  hydrateMailImportance,
  listCapturedImportantMessages,
  parseCapturedImportanceSearch,
  processPendingMailImportance,
} from "../mail-importance";
import { assertAccessibleMailbox } from "../mailbox/service";
import { getManagedMessageAttachment } from "../managed-mail/messages/attachments";
import { getManagedDraft } from "../managed-mail/messages/get-draft";
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
  getDraft: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["getDraft"];
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      const draft = await getManagedDraft({ ...input, userId: context.userId });
      await captureMailboxDraftMemory({
        draft,
        draftId: input.draftId,
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      return draft;
    }
    return await callGmail(
      context,
      input.mailboxId,
      async (accessToken, signal) => {
        const { draft, bodyHtml, bodyText } = await getDraftWithContent(
          accessToken,
          input.draftId,
          signal
        ).catch((error: unknown) => {
          if (isGmailServiceError(error) && error.status === 404) {
            throw new ORPCError("NOT_FOUND", {
              message: "This draft is no longer available.",
            });
          }
          throw error;
        });
        if (!draft.message) {
          throw new ORPCError("NOT_FOUND", {
            message: "This draft is no longer available.",
          });
        }
        const parsed = parseDraftMessage(draft, { bodyHtml, bodyText });
        await captureMailboxDraftMemory({
          draft: {
            ...parsed,
            bodyHtml: bodyHtml ?? parsed.bodyHtml,
            bodyText: bodyText ?? parsed.bodyText,
          },
          draftId: draft.id,
          mailboxId: input.mailboxId,
          userId: context.userId,
        });
        return {
          ...parsed,
          attachments: parsed.attachments.map((asset) => ({
            gmailAttachmentId: asset.attachmentId,
            id: crypto.randomUUID(),
            isInline: false as const,
            mimeType: asset.mimeType,
            name: asset.fileName,
            size: asset.size,
            sourceMessageId: draft.message?.id,
          })),
          baseRevision: draft.message.id,
          bodyHtml: bodyHtml ?? parsed.bodyHtml,
          bodyText: bodyText ?? parsed.bodyText,
          draftId: draft.id,
          inlineImages: parsed.inlineImages.map((asset) => ({
            contentId: asset.contentId,
            gmailAttachmentId: asset.attachmentId,
            id: crypto.randomUUID(),
            isInline: true as const,
            mimeType: asset.mimeType,
            name: asset.fileName,
            size: asset.size,
            sourceMessageId: draft.message?.id,
          })),
          lastSavedAt: Number(draft.message.internalDate) || undefined,
          replyContext:
            parsed.draftAnchor?.seededBy !== "forward" && parsed.inReplyTo
              ? parsed.replyContext
              : null,
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
    await queueMailboxMessageMemory({
      mailboxId: input.mailboxId,
      messageIds: [input.messageId],
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
    const thread =
      selectedMailbox.provider === "managed"
        ? await getManagedThread({ ...input, userId: context.userId })
        : await callGmail(
            context,
            input.mailboxId,
            async (accessToken, signal) =>
              await getThreadWithDetails(
                accessToken,
                input.threadId,
                signal,
                async (snapshot) => {
                  await writeGmailCapturedMessage({
                    mailboxId: input.mailboxId,
                    snapshot,
                    source: "on_demand",
                  });
                }
              )
          ).catch((error: unknown) => {
            if (isGmailServiceError(error) && error.status === 404) {
              throw new ORPCError("NOT_FOUND", {
                message: "Message thread not found.",
              });
            }
            throw error;
          });
    const capture = Promise.all(
      thread.messages.map(
        async (message) =>
          await captureMailboxMessageMemory({
            actorUserId: context.userId,
            mailboxId: input.mailboxId,
            message,
            source: "open",
          })
      )
    );
    if (context.scheduleBackgroundTask) {
      context.scheduleBackgroundTask(capture);
    } else {
      await capture;
    }
    if (selectedMailbox.provider === "managed") {
      return thread;
    }
    context.scheduleBackgroundTask?.(
      processPendingMailImportance({ limit: 4, mailboxId: input.mailboxId })
    );
    return {
      ...thread,
      messages: await hydrateUnsubscribeStatus(
        input.mailboxId,
        await hydrateMailImportance(input.mailboxId, thread.messages)
      ),
    };
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

    if (input.category === "important") {
      const searchExpression = parseCapturedImportanceSearch(input.query);
      const pending: MailSearchExpression[] = searchExpression
        ? [searchExpression]
        : [];
      const labelFilters: MailSearchFilter[] = [];
      while (pending.length > 0) {
        const expression = pending.pop();
        if (
          expression?.type === "filter" &&
          expression.filter.type === "label"
        ) {
          labelFilters.push(expression.filter);
        } else if (expression?.type === "and" || expression?.type === "or") {
          pending.push(expression.left, expression.right);
        } else if (expression?.type === "not") {
          pending.push(expression.operand);
        }
      }
      if (labelFilters.length > 0) {
        const labels = await callGmail(
          context,
          input.mailboxId,
          async (accessToken, signal) => await listLabels(accessToken, signal)
        );
        const labelIdsByName = new Map(
          labels.map((label) => [label.name.toLocaleLowerCase(), label.id])
        );
        for (const filter of labelFilters) {
          filter.value =
            labels.find((label) => label.id === filter.value)?.id ??
            labelIdsByName.get(filter.value.toLocaleLowerCase()) ??
            filter.value;
        }
      }
      const page = await listCapturedImportantMessages({
        ...input,
        searchExpression,
      });
      return {
        ...page,
        messages: await hydrateUnsubscribeStatus(
          input.mailboxId,
          page.messages
        ),
      };
    }
    const page = await callGmail(
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
    return {
      ...page,
      historyId: page.historyId
        ? `gmail:${page.historyId}:${selectedMailbox.contentRevision}`
        : undefined,
      messages: await hydrateUnsubscribeStatus(
        input.mailboxId,
        await hydrateMailImportance(input.mailboxId, page.messages)
      ),
    };
  },
  syncMailbox: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["syncMailbox"];
  }): Promise<MailboxSyncDelta> => {
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

    if (input.category === "important") {
      const historyId = `app:${selectedMailbox.contentRevision}`;
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
    const token = /^gmail:(?<provider>\d+):(?<revision>\d+)$/u.exec(
      input.startHistoryId
    );
    const appChanged =
      token?.groups?.revision !== String(selectedMailbox.contentRevision);
    const delta = await callGmail(
      context,
      input.mailboxId,
      async (accessToken, signal) =>
        await getMailboxSyncDelta(accessToken, {
          mailbox: input.category,
          signal,
          startHistoryId: token?.groups?.provider ?? input.startHistoryId,
        })
    );
    return {
      ...delta,
      hasChanges: delta.hasChanges || appChanged,
      historyId: delta.historyId
        ? `gmail:${delta.historyId}:${selectedMailbox.contentRevision}`
        : undefined,
      refreshFirstPage: delta.refreshFirstPage || appChanged,
      requiresFullRefresh: delta.requiresFullRefresh || appChanged,
      updatedMessages: await hydrateUnsubscribeStatus(
        input.mailboxId,
        await hydrateMailImportance(input.mailboxId, delta.updatedMessages)
      ),
    };
  },
};
