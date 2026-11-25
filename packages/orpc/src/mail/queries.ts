import { ORPCError } from "@orpc/server";
import { withRequestDatabaseClient } from "@quieter/database/client";
import {
  getGmailThreadChangeDelta,
  getMailboxSyncDelta,
  getMessageAttachment,
  getDraftWithContent,
  getMessageInspector,
  getThreadWithDetails,
  getGmailConversationListRows,
  isGmailServiceError,
  listDraftsWithDetails,
  listMessagesWithDetails,
  listLabels,
} from "@quieter/gmail";
import { parseDraftMessage } from "@quieter/gmail/compose";
import type { CapturedMailSnapshot } from "@quieter/mail/capture";
import type {
  ListMessagesPageResult,
  MailboxSyncDelta,
  MessageListItem,
} from "@quieter/mail/messages";
import type { MailSearchFilter } from "@quieter/mail/search";
import type { MailSearchExpression } from "@quieter/mail/search-expression";
import { reportError } from "@quieter/observability";

import {
  captureMailboxDraftMemory,
  captureMailboxMessageMemory,
  queueMailboxMessageMemory,
} from "../ai-memory-capture";
import { hydrateUnsubscribeStatus } from "../gmail-compose";
import { getGmailMessageDelivery } from "../gmail-open-tracking";
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
import { readMailboxChanges } from "../mailbox-changes";
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
import { loadDraftReminderIntent } from "../reminders/draft-state";
import {
  attachMailSnoozeStates,
  countVisibleMailSnoozes,
  filterMailSnoozeVisibility,
  listMailSnoozePage,
} from "../snooze/queries";
import type { MailInputs } from "./inputs";

const MAX_VISIBILITY_SCAN_PAGES = 5;

const hydrateGmailMessageMetadata = async <T extends MessageListItem>(
  mailboxId: string,
  messages: T[],
  responseHeaders?: Headers
) => {
  const startedAt = performance.now();
  const [importance, unsubscribe] = await Promise.all([
    hydrateMailImportance(mailboxId, messages),
    hydrateUnsubscribeStatus(mailboxId, messages),
  ]);
  responseHeaders?.append(
    "Server-Timing",
    `mail_metadata;dur=${(performance.now() - startedAt).toFixed(1)}`
  );
  return importance.map((message, index) => {
    const unsubscribeStatus = unsubscribe[index]?.unsubscribeStatus;
    return unsubscribeStatus === undefined
      ? message
      : { ...message, unsubscribeStatus };
  });
};

const listLaterMessages = async (input: {
  context: MailRequestContext;
  mailboxId: string;
  provider: "gmail" | "managed";
  contentRevision: number;
  maxResults?: number;
  pageToken?: string;
}): Promise<ListMessagesPageResult> => {
  let { pageToken } = input;
  let pagesScanned = 0;
  while (true) {
    input.context.signal?.throwIfAborted();
    const scheduled = await listMailSnoozePage({
      mailboxId: input.mailboxId,
      maxResults: input.maxResults,
      pageToken,
      userId: input.context.userId,
    });
    const threadIds = scheduled.snoozes.map((snooze) => snooze.threadId);
    pagesScanned += 1;
    if (threadIds.length === 0) {
      if (
        scheduled.nextPageToken === undefined ||
        pagesScanned >= MAX_VISIBILITY_SCAN_PAGES
      ) {
        return {
          messages: [],
          nextPageToken: scheduled.nextPageToken,
        };
      }
      pageToken = scheduled.nextPageToken;
      continue;
    }
    const page =
      input.provider === "managed"
        ? await listManagedMessages({
            category: "later",
            mailboxId: input.mailboxId,
            maxResults: Math.max(1, threadIds.length),
            threadIds,
            userId: input.context.userId,
          })
        : await callGmail(
            input.context,
            input.mailboxId,
            async (accessToken, signal) =>
              await getGmailConversationListRows(accessToken, threadIds, signal)
          );
    const messages = await attachMailSnoozeStates({
      mailboxId: input.mailboxId,
      messages:
        input.provider === "managed"
          ? page.messages
          : await hydrateGmailMessageMetadata(
              input.mailboxId,
              page.messages,
              input.context.resHeaders
            ),
      userId: input.context.userId,
    });
    const visible = await filterMailSnoozeVisibility({
      category: "later",
      mailboxId: input.mailboxId,
      threadIds,
      userId: input.context.userId,
    });
    const rows = new Map(
      messages.map((message) => [message.threadId, message])
    );
    const ordered = threadIds.flatMap((threadId) => {
      const message = rows.get(threadId);
      return message && visible.has(threadId) ? [message] : [];
    });
    if (
      ordered.length > 0 ||
      scheduled.nextPageToken === undefined ||
      pagesScanned >= MAX_VISIBILITY_SCAN_PAGES
    ) {
      return {
        historyId:
          input.provider === "gmail" && page.historyId
            ? `gmail:${page.historyId}:${input.contentRevision}`
            : page.historyId,
        messages: ordered,
        nextPageToken: scheduled.nextPageToken,
      };
    }
    pageToken = scheduled.nextPageToken;
  }
};

const gmailReplayFallback: MailboxSyncDelta = {
  hasChanges: true,
  refreshFirstPage: false,
  removedMessageIds: [],
  requiresFullRefresh: true,
  updatedMessages: [],
};

const projectSnoozableGmailRows = async (input: {
  category: MailInputs["listThreads"]["category"];
  context: MailRequestContext;
  mailboxId: string;
  messages: MessageListItem[];
}) => {
  const { category, context, mailboxId } = input;
  const messages = await attachMailSnoozeStates({
    mailboxId,
    messages: await hydrateGmailMessageMetadata(
      mailboxId,
      input.messages,
      context.resHeaders
    ),
    userId: context.userId,
  });
  const visible = await filterMailSnoozeVisibility({
    category,
    mailboxId,
    threadIds: messages.map((message) => message.threadId),
    userId: context.userId,
  });
  return messages.filter((message) => visible.has(message.threadId));
};

const replayGmailMailbox = async ({
  context,
  contentRevision,
  headVersion,
  input,
  providerCursor,
  startChangeVersion,
}: {
  context: MailRequestContext;
  contentRevision: number;
  headVersion: bigint;
  input: MailInputs["syncMailbox"];
  providerCursor?: { provider?: string; revision?: string };
  startChangeVersion: string;
}): Promise<MailboxSyncDelta> => {
  const replay = await readMailboxChanges({
    afterVersion: startChangeVersion,
    headVersion,
    mailboxId: input.mailboxId,
    userId: context.userId,
  });
  const important = input.category === "important";
  const previousRevision = important
    ? /^app:(?<revision>\d+)$/u.exec(input.startHistoryId)?.groups?.revision
    : providerCursor?.revision;
  const previous = Number(previousRevision);
  if (
    replay === null ||
    !Number.isSafeInteger(previous) ||
    replay.contentRevisions.length !== contentRevision - previous ||
    replay.contentRevisions.some(
      (revision, index) => revision !== previous + index + 1
    )
  ) {
    return gmailReplayFallback;
  }
  const affectedThreadIds = new Set<string>();
  const affectedMessageThreads = new Map<string, string | undefined>();
  for (const change of replay.changes) {
    if ("messageId" in change) {
      affectedMessageThreads.set(
        change.messageId,
        change.threadId ?? affectedMessageThreads.get(change.messageId)
      );
    } else if (
      change.kind === "importance.changed" ||
      change.kind === "capture.changed"
    ) {
      affectedThreadIds.add(change.threadId);
    }
  }
  const changeVersion = String(headVersion);
  if (important) {
    for (const threadId of affectedMessageThreads.values()) {
      if (threadId === undefined) {
        return gmailReplayFallback;
      }
      affectedThreadIds.add(threadId);
    }
    const threadIds = [...affectedThreadIds];
    const page =
      threadIds.length > 0
        ? await listCapturedImportantMessages({
            mailboxId: input.mailboxId,
            matchingThreadIds: threadIds,
            maxResults: threadIds.length,
          })
        : undefined;
    return {
      changeVersion,
      hasChanges: threadIds.length > 0,
      historyId: `app:${contentRevision}`,
      refreshFirstPage: false,
      refreshThreadIds: threadIds,
      removedMessageIds: [],
      replacedThreadIds: threadIds,
      requiresFullRefresh: false,
      updatedMessages: page
        ? await attachMailSnoozeStates({
            mailboxId: input.mailboxId,
            messages: await hydrateUnsubscribeStatus(
              input.mailboxId,
              page.messages
            ),
            userId: context.userId,
          })
        : [],
    };
  }
  const delta = await callGmail(
    context,
    input.mailboxId,
    async (accessToken, signal) =>
      await getGmailThreadChangeDelta(accessToken, {
        affectedMessageThreads,
        affectedThreadIds,
        mailbox: input.category,
        reconcileProvider:
          input.targetChangeVersion === undefined ||
          BigInt(input.targetChangeVersion) > headVersion,
        signal,
        startHistoryId: providerCursor?.provider ?? "",
      })
  );
  return {
    ...delta,
    changeVersion: delta.requiresFullRefresh ? undefined : changeVersion,
    historyId: delta.historyId
      ? `gmail:${delta.historyId}:${contentRevision}`
      : undefined,
    updatedMessages: await projectSnoozableGmailRows({
      category: input.category,
      context,
      mailboxId: input.mailboxId,
      messages: delta.updatedMessages,
    }),
  };
};

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
    const followUpReminder = await loadDraftReminderIntent({
      draftId: input.draftId,
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
      return {
        ...draft,
        ...(followUpReminder === undefined ? {} : { followUpReminder }),
      };
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
          ...(followUpReminder === undefined ? {} : { followUpReminder }),
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
      return await getGmailMessageDelivery(input);
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
    const snapshots: CapturedMailSnapshot[] = [];
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
                input.prefetch === true
                  ? undefined
                  : (snapshot) => {
                      snapshots.push(snapshot);
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
    const result =
      selectedMailbox.provider === "managed"
        ? thread
        : {
            ...thread,
            messages: await hydrateGmailMessageMetadata(
              input.mailboxId,
              thread.messages,
              context.resHeaders
            ),
          };
    if (input.prefetch === true) {
      return result;
    }
    const capture = (async () => {
      try {
        await withRequestDatabaseClient(
          async () => {
            const failures: unknown[] = [];
            for (const snapshot of snapshots) {
              try {
                await writeGmailCapturedMessage({
                  mailboxId: input.mailboxId,
                  snapshot,
                  source: "on_demand",
                });
              } catch (error) {
                failures.push(error);
              }
            }
            for (let offset = 0; offset < thread.messages.length; offset += 4) {
              const outcomes = await Promise.allSettled(
                thread.messages.slice(offset, offset + 4).map(
                  async (message) =>
                    await captureMailboxMessageMemory({
                      actorUserId: context.userId,
                      mailboxId: input.mailboxId,
                      message,
                      source: "open",
                    })
                )
              );
              for (const outcome of outcomes) {
                if (outcome.status === "rejected") {
                  failures.push(outcome.reason);
                }
              }
            }
            if (selectedMailbox.provider !== "managed") {
              try {
                await processPendingMailImportance({
                  limit: 4,
                  mailboxId: input.mailboxId,
                });
              } catch (error) {
                failures.push(error);
              }
            }
            if (failures.length > 0) {
              throw new AggregateError(failures, "Thread capture failed.");
            }
          },
          { independent: context.scheduleBackgroundTask !== undefined }
        );
      } catch (error) {
        if (!context.scheduleBackgroundTask) {
          throw error;
        }
        reportError(error, { operation: "mail:capture-open-thread" });
      }
    })();
    if (context.scheduleBackgroundTask) {
      context.scheduleBackgroundTask(capture);
    } else {
      await capture;
    }
    const messages = await attachMailSnoozeStates({
      mailboxId: input.mailboxId,
      messages: result.messages,
      userId: context.userId,
    });
    return { ...result, messages, snooze: messages[0]?.snooze };
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
      includeChangeVersion: true,
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (input.category === "later" && !input.query?.trim()) {
      return await listLaterMessages({
        ...input,
        contentRevision: selectedMailbox.contentRevision,
        context,
        provider: selectedMailbox.provider === "managed" ? "managed" : "gmail",
      });
    }
    if (selectedMailbox.provider === "managed") {
      let { pageToken } = input;
      let pagesScanned = 0;
      while (true) {
        context.signal?.throwIfAborted();
        const page = await listManagedMessages({
          ...input,
          pageToken,
          userId: context.userId,
        });
        const messages = await attachMailSnoozeStates({
          mailboxId: input.mailboxId,
          messages: page.messages,
          userId: context.userId,
        });
        const visible = await filterMailSnoozeVisibility({
          category: input.category,
          mailboxId: input.mailboxId,
          threadIds: messages.map((message) => message.threadId),
          userId: context.userId,
        });
        const filtered = messages.filter((message) =>
          visible.has(message.threadId)
        );
        pagesScanned += 1;
        if (
          filtered.length > 0 ||
          page.nextPageToken === undefined ||
          pagesScanned >= MAX_VISIBILITY_SCAN_PAGES
        ) {
          return { ...page, messages: filtered };
        }
        pageToken = page.nextPageToken;
      }
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
        changeVersion: String(selectedMailbox.mailChangeVersion),
        historyId: `app:${selectedMailbox.contentRevision}`,
        messages: await attachMailSnoozeStates({
          mailboxId: input.mailboxId,
          messages: await hydrateUnsubscribeStatus(
            input.mailboxId,
            page.messages
          ),
          userId: context.userId,
        }),
      };
    }
    if (input.category === "later") {
      const visibleSnoozeCount = await countVisibleMailSnoozes({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      if (visibleSnoozeCount === 0) {
        return { messages: [] };
      }
    }
    let { pageToken } = input;
    let pagesScanned = 0;
    while (true) {
      context.signal?.throwIfAborted();
      const currentPageToken = pageToken;
      const page = await callGmail(
        context,
        input.mailboxId,
        async (accessToken, signal) =>
          input.category === "drafts"
            ? await listDraftsWithDetails(accessToken, {
                maxResults: input.maxResults,
                pageToken: currentPageToken,
                query: input.query?.trim() || undefined,
                signal,
              })
            : await listMessagesWithDetails(accessToken, {
                mailbox: input.category,
                maxResults: input.maxResults,
                pageToken: currentPageToken,
                query: input.query?.trim() || undefined,
                signal,
              })
      );
      const messages = await projectSnoozableGmailRows({
        category: input.category,
        context,
        mailboxId: input.mailboxId,
        messages: page.messages,
      });
      pagesScanned += 1;
      if (
        messages.length > 0 ||
        page.nextPageToken === undefined ||
        pagesScanned >= MAX_VISIBILITY_SCAN_PAGES
      ) {
        return {
          ...page,
          changeVersion:
            input.category === "later"
              ? undefined
              : String(selectedMailbox.mailChangeVersion),
          historyId: page.historyId
            ? `gmail:${page.historyId}:${selectedMailbox.contentRevision}`
            : undefined,
          messages,
        };
      }
      pageToken = page.nextPageToken;
    }
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
      includeChangeVersion: input.startChangeVersion !== undefined,
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

    const token = /^gmail:(?<provider>\d+):(?<revision>\d+)$/u.exec(
      input.startHistoryId
    );
    if (
      input.startChangeVersion !== undefined &&
      selectedMailbox.mailChangeVersion !== undefined
    ) {
      return await replayGmailMailbox({
        contentRevision: selectedMailbox.contentRevision,
        context,
        headVersion: selectedMailbox.mailChangeVersion,
        input,
        providerCursor: token?.groups,
        startChangeVersion: input.startChangeVersion,
      });
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
    const appChanged =
      token?.groups?.revision !== String(selectedMailbox.contentRevision);
    if (token !== null && appChanged) {
      return {
        hasChanges: true,
        refreshFirstPage: true,
        removedMessageIds: [],
        requiresFullRefresh: true,
        updatedMessages: [],
      };
    }
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
      updatedMessages: await projectSnoozableGmailRows({
        category: input.category,
        context,
        mailboxId: input.mailboxId,
        messages: delta.updatedMessages,
      }),
    };
  },
};
