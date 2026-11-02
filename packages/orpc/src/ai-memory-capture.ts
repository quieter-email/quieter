import { createHash } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { retryIdempotentDatabaseQuery } from "@quieter/database/retry";
import {
  aiMemoryMailboxState,
  aiMemoryScopeConfig,
  mailbox,
  managedMailMessage,
  member,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import {
  getMessageWithDetails,
  isGmailServiceError,
  listGmailMessageIds,
} from "@quieter/gmail";
import type { composeDraftInputSchema } from "@quieter/mail/compose/schema";
import { MAILBOX_LABELS } from "@quieter/mail/messages";
import type { MessageListItem } from "@quieter/mail/messages";
import { reportError } from "@quieter/observability";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { convert } from "html-to-text";
import { z } from "zod";

import {
  extractAuthoredMailText,
  isAiGeneratedMailBody,
} from "./ai-mail-authorship";
import {
  getPersonalAiMemoryScopeConfig,
  recordAiMemoryEvent,
} from "./ai-memory";
import { runAuthorizedGmailMailbox } from "./gmail-mailbox-access";
import { getAuthorizedManagedMailbox } from "./mailbox/access";

export { extractAuthoredMailText } from "./ai-mail-authorship";

type MailMemorySource =
  | "bootstrap"
  | "sync"
  | "received"
  | "open"
  | "ai_read"
  | "draft"
  | "sent"
  | "action";

type MemoryMailbox = Pick<
  typeof mailbox.$inferSelect,
  | "id"
  | "accessMode"
  | "emailAddress"
  | "provider"
  | "ownerUserId"
  | "managedOwnerUserId"
  | "signatureHtml"
  | "signatureText"
>;

const BOOTSTRAP_MESSAGE_LIMIT = 50;
const BOOTSTRAP_PAGE_SIZE = 10;
const BOOTSTRAP_LEASE_MS = 5 * 60_000;
const managedCursorSchema = z.tuple([z.iso.datetime(), z.string().min(1)]);

export const listMemoryCorrespondents = (addresses: string | undefined) => [
  ...new Set(
    addresses
      ?.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+/giu)
      ?.map((address) => address.toLowerCase())
  ),
];

const loadMemoryMailbox = async (mailboxId: string) => {
  const [selected] = await db
    .select({
      accessMode: mailbox.accessMode,
      emailAddress: mailbox.emailAddress,
      id: mailbox.id,
      managedOwnerUserId: mailbox.managedOwnerUserId,
      ownerUserId: mailbox.ownerUserId,
      provider: mailbox.provider,
      signatureHtml: mailbox.signatureHtml,
      signatureText: mailbox.signatureText,
    })
    .from(mailbox)
    .where(eq(mailbox.id, mailboxId))
    .limit(1);
  return selected;
};

const resolveMemoryActor = async (
  selected: MemoryMailbox,
  actorUserId?: string
) => {
  if (selected.provider === "gmail") {
    if (
      !selected.ownerUserId ||
      (actorUserId !== undefined && actorUserId !== selected.ownerUserId)
    ) {
      return null;
    }
    return { userId: selected.ownerUserId };
  }
  if (
    selected.accessMode === "private" &&
    actorUserId !== undefined &&
    actorUserId !== selected.managedOwnerUserId
  ) {
    return null;
  }
  const userId =
    actorUserId ??
    (selected.accessMode === "private" ? selected.managedOwnerUserId : null);
  if (!userId) {
    return null;
  }
  try {
    await getAuthorizedManagedMailbox({ mailboxId: selected.id, userId });
    return { userId };
  } catch (error) {
    if (error instanceof ORPCError && error.code === "NOT_FOUND") {
      return null;
    }
    throw error;
  }
};

export const getMailboxMemoryActor = async (input: {
  actorUserId?: string;
  mailboxId: string;
}) => {
  const selected = await loadMemoryMailbox(input.mailboxId);
  return selected === undefined
    ? null
    : await resolveMemoryActor(selected, input.actorUserId);
};

const buildMailMemoryEvidence = async ({
  userId,
  message,
  selected,
  source,
}: {
  message: MessageListItem;
  selected: MemoryMailbox;
  source: MailMemorySource;
  userId: string;
}) => {
  const isDraft =
    !!message.draftId ||
    message.labelIds?.includes(MAILBOX_LABELS.drafts) === true;
  const isSent =
    !isDraft &&
    (source === "sent" ||
      message.labelIds?.includes(MAILBOX_LABELS.sent) === true);
  const bodyText =
    isSent || isDraft
      ? extractAuthoredMailText(message).slice(0, 20_000)
      : (
          message.bodyText ||
          convert(message.bodyHtml ?? "", { wordwrap: false })
        )
          .trim()
          .slice(0, 20_000);
  if (!bodyText) {
    return null;
  }
  const aiGenerated =
    (isSent || isDraft) &&
    (await isAiGeneratedMailBody({
      ...message,
      mailboxId: selected.id,
      signatureHtml: selected.signatureHtml,
      signatureText: selected.signatureText,
    }));
  const sender = listMemoryCorrespondents(
    message.from ?? (isSent || isDraft ? selected.emailAddress : undefined)
  ).join(", ");
  const recipients = listMemoryCorrespondents(
    [message.to, message.cc, message.bcc].join(", ")
  ).join(", ");
  let observationKind = "received_message";
  let authorship = "third_party";
  if (isSent) {
    observationKind = "sent_message";
    const ownerUserId =
      selected.provider === "gmail"
        ? selected.ownerUserId
        : selected.managedOwnerUserId;
    authorship =
      source === "sent" ||
      (selected.accessMode === "private" && ownerUserId === userId)
        ? "observed_outbound"
        : "unattributed_outbound";
  }
  if (isDraft) {
    observationKind = "draft_message";
    authorship = "unsent_draft";
  }
  return {
    aiGenerated,
    authorship: aiGenerated ? "ai_generated" : authorship,
    bodyText,
    correspondents: isSent || isDraft ? recipients : sender,
    date: message.date ?? message.internalDate ?? null,
    evidence: isDraft ? "provisional_unsent_draft" : "observed_mail",
    from: message.from ?? null,
    isReply: !!message.inReplyTo,
    messageId: message.id,
    observationKind,
    recipients,
    sender,
    source,
    subject: message.subject ?? null,
    threadId: message.threadId,
    userAuthored:
      isSent && !aiGenerated && authorship === "observed_outbound"
        ? null
        : false,
  };
};

export const captureMailboxMessageMemory = async (input: {
  actorUserId?: string;
  bootstrapLease?: string;
  failureMode?: "retry";
  mailboxId: string;
  message: MessageListItem;
  source: MailMemorySource;
}) => {
  try {
    const selected = await loadMemoryMailbox(input.mailboxId);
    if (selected === undefined) {
      return null;
    }
    const actor = await resolveMemoryActor(selected, input.actorUserId);
    if (actor === null) {
      return null;
    }
    const metadata = await buildMailMemoryEvidence({
      message: input.message,
      selected,
      source: input.source,
      userId: actor.userId,
    });
    if (metadata === null) {
      return null;
    }
    const isDraft = metadata.observationKind === "draft_message";
    const revision = isDraft
      ? createHash("sha256")
          .update(
            JSON.stringify([
              metadata.bodyText,
              metadata.recipients,
              metadata.subject,
            ])
          )
          .digest("hex")
      : null;
    const event = await recordAiMemoryEvent({
      eventKey: isDraft
        ? `draft:${input.message.draftId ?? input.message.id}:${revision}`
        : `message:${input.message.id}`,
      kind: "mail_action",
      mailboxId: input.mailboxId,
      metadata: {
        ...metadata,
        bootstrapLease: input.bootstrapLease ?? null,
      },
      userId: actor.userId,
    });
    if (input.source !== "open" && input.source !== "ai_read") {
      return event;
    }
    const engagement = await recordAiMemoryEvent({
      eventKey: `engagement:${input.source}:${input.message.id}`,
      kind: "mail_action",
      mailboxId: input.mailboxId,
      metadata: {
        ...metadata,
        action: input.source,
        messageContextOnly: true,
        observationKind: "mail_action",
        targetCount: 1,
      },
      userId: actor.userId,
    });
    return event ?? engagement;
  } catch (error) {
    reportError(new Error("Mail context could not be recorded."), {
      operation: "ai-memory:capture-mail",
    });
    if (
      input.failureMode === "retry" ||
      ["bootstrap", "sync", "received"].includes(input.source)
    ) {
      throw error;
    }
    return null;
  }
};

export const queueMailboxMessageMemory = async (input: {
  mailboxId: string;
  messageIds: string[];
  userId: string;
}) => {
  let actor: Awaited<ReturnType<typeof getMailboxMemoryActor>>;
  try {
    actor = await getMailboxMemoryActor({
      actorUserId: input.userId,
      mailboxId: input.mailboxId,
    });
  } catch {
    reportError(new Error("Mail action context could not be queued."), {
      operation: "ai-memory:queue-mail",
    });
    return;
  }
  if (actor === null) {
    return;
  }
  for (const messageId of new Set(input.messageIds)) {
    try {
      await recordAiMemoryEvent({
        eventKey: `message:${messageId}`,
        kind: "mail_action",
        mailboxId: input.mailboxId,
        metadata: {
          hydrateMessage: true,
          messageId,
          observationKind: "mail_capture",
          source: "action",
        },
        userId: actor.userId,
      });
    } catch {
      reportError(new Error("Mail action context could not be queued."), {
        operation: "ai-memory:queue-mail",
      });
    }
  }
};

export const captureMailboxDraftMemory = async (input: {
  draft: Pick<
    z.infer<typeof composeDraftInputSchema>,
    "bodyHtml" | "bodyText" | "recipients" | "subject" | "replyContext"
  >;
  draftId: string;
  mailboxId: string;
  userId: string;
}) =>
  await captureMailboxMessageMemory({
    actorUserId: input.userId,
    mailboxId: input.mailboxId,
    message: {
      bcc: input.draft.recipients.bcc,
      bodyHtml: input.draft.bodyHtml,
      bodyText: input.draft.bodyText,
      cc: input.draft.recipients.cc,
      draftId: input.draftId,
      id: input.draftId,
      subject: input.draft.subject,
      threadId: input.draft.replyContext?.threadId ?? input.draftId,
      to: input.draft.recipients.to,
    },
    source: "draft",
  });

const loadManagedMemoryMessage = async (input: {
  mailboxId: string;
  messageId: string;
}): Promise<MessageListItem | null> => {
  const [message] = await db
    .select()
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.mailboxId, input.mailboxId),
        eq(managedMailMessage.id, input.messageId)
      )
    )
    .limit(1);
  if (message === undefined) {
    return null;
  }
  return {
    bcc: message.bcc ?? undefined,
    bodyHtml: message.bodyHtml ?? undefined,
    bodyText: message.bodyText ?? undefined,
    cc: message.cc ?? undefined,
    date: message.sentAt.toISOString(),
    draftId:
      message.mailboxState === "draft" ? message.providerMessageId : undefined,
    from: message.from,
    id: message.id,
    inReplyTo: message.inReplyTo ?? undefined,
    labelIds: message.direction === "outbound" ? [MAILBOX_LABELS.sent] : [],
    subject: message.subject ?? undefined,
    threadId: message.threadId,
    to: message.to ?? undefined,
  };
};

export const captureManagedMessageMemory = async (input: {
  actorUserId?: string;
  bootstrapLease?: string;
  failureMode?: "retry";
  mailboxId: string;
  messageId: string;
  source: MailMemorySource;
}) => {
  const message = await loadManagedMemoryMessage(input);
  return message === null
    ? null
    : await captureMailboxMessageMemory({ ...input, message });
};

export const hydrateMailMemoryEvent = async (input: {
  mailboxId: string;
  messageId: string;
  userId: string;
}) => {
  const selected = await loadMemoryMailbox(input.mailboxId);
  if (
    selected === undefined ||
    (await resolveMemoryActor(selected, input.userId)) === null
  ) {
    return null;
  }
  let message: MessageListItem | null;
  if (selected.provider === "gmail") {
    try {
      message = await runAuthorizedGmailMailbox(
        input,
        async (accessToken) =>
          await getMessageWithDetails(accessToken, input.messageId)
      );
    } catch (error) {
      if (isGmailServiceError(error) && error.status === 404) {
        return null;
      }
      throw error;
    }
  } else {
    message = await loadManagedMemoryMessage(input);
  }
  if (message === null) {
    return null;
  }
  const { enrichMailAutoLabelFeedbackSource } =
    await import("./mail-automation/memory");
  await enrichMailAutoLabelFeedbackSource({
    from: message.from,
    mailboxId: input.mailboxId,
    providerMessageId: message.id,
    userId: input.userId,
  });
  return await buildMailMemoryEvidence({
    message,
    selected,
    source: "action",
    userId: input.userId,
  });
};

const assertPrivateMemoryMailbox = async (input: {
  mailboxId: string;
  userId: string;
}) => {
  const selected = await loadMemoryMailbox(input.mailboxId);
  const ownerUserId =
    selected?.provider === "gmail"
      ? selected.ownerUserId
      : selected?.managedOwnerUserId;
  if (
    selected === undefined ||
    ownerUserId !== input.userId ||
    (selected.provider === "managed" && selected.accessMode !== "private")
  ) {
    throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
  }
  if (selected.provider === "managed") {
    await getAuthorizedManagedMailbox(input);
  }
  return selected;
};

export const getMailboxMemoryBootstrap = async (input: {
  mailboxId: string;
  userId: string;
}) => {
  const selected = await assertPrivateMemoryMailbox(input);
  const states = await db
    .select()
    .from(aiMemoryMailboxState)
    .where(
      and(
        eq(aiMemoryMailboxState.mailboxId, input.mailboxId),
        eq(aiMemoryMailboxState.userId, input.userId)
      )
    )
    .limit(1);
  const state = states.at(0);
  return {
    emailAddress: selected.emailAddress,
    lastError: state?.lastError ?? null,
    mailboxId: input.mailboxId,
    receivedCount: state?.receivedCount ?? 0,
    sentCount: state?.sentCount ?? 0,
    status: state?.status ?? ("not_started" as const),
  };
};

export const listMailboxMemoryBootstraps = async (userId: string) => {
  const mailboxes = await db
    .select({ id: mailbox.id })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.status, "connected"),
        or(
          and(eq(mailbox.provider, "gmail"), eq(mailbox.ownerUserId, userId)),
          and(
            eq(mailbox.provider, "managed"),
            eq(mailbox.accessMode, "private"),
            eq(mailbox.managedOwnerUserId, userId),
            exists(
              db
                .select({ id: member.id })
                .from(member)
                .where(
                  and(
                    eq(member.userId, userId),
                    eq(member.organizationId, mailbox.organizationId)
                  )
                )
            )
          )
        )
      )
    );
  return await Promise.all(
    mailboxes.map(
      async ({ id }) =>
        await getMailboxMemoryBootstrap({ mailboxId: id, userId })
    )
  );
};

export const queueMailboxMemoryBootstrap = async (input: {
  mailboxId: string;
  userId: string;
}) => {
  await assertPrivateMemoryMailbox(input);
  const config = await getPersonalAiMemoryScopeConfig(input.userId);
  if (!config.activeLearningEnabled) {
    return;
  }
  const now = new Date();
  await db
    .insert(aiMemoryMailboxState)
    .values({
      createdAt: now,
      mailboxId: input.mailboxId,
      updatedAt: now,
      userId: input.userId,
    })
    .onConflictDoUpdate({
      set: {
        createdAt: now,
        lastError: null,
        processingAt: null,
        receivedComplete: false,
        receivedCount: 0,
        receivedCursor: null,
        sentComplete: false,
        sentCount: 0,
        sentCursor: null,
        status: "pending",
        updatedAt: now,
        userId: input.userId,
      },
      setWhere: sql`${aiMemoryMailboxState.userId} is distinct from ${input.userId}`,
      target: aiMemoryMailboxState.mailboxId,
    });
};

export const retryMailboxMemoryBootstrap = async (input: {
  mailboxId: string;
  userId: string;
}) => {
  await queueMailboxMemoryBootstrap(input);
  await db
    .update(aiMemoryMailboxState)
    .set({
      lastError: null,
      processingAt: null,
      status: "pending",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(aiMemoryMailboxState.mailboxId, input.mailboxId),
        eq(aiMemoryMailboxState.status, "failed")
      )
    );
  return await getMailboxMemoryBootstrap(input);
};

const captureBootstrapDirection = async (input: {
  direction: "received" | "sent";
  selected: MemoryMailbox;
  state: typeof aiMemoryMailboxState.$inferSelect;
  userId: string;
}) => {
  const sent = input.direction === "sent";
  const count = sent ? input.state.sentCount : input.state.receivedCount;
  const cursor = sent ? input.state.sentCursor : input.state.receivedCursor;
  const maxResults = Math.min(
    BOOTSTRAP_PAGE_SIZE,
    BOOTSTRAP_MESSAGE_LIMIT - count
  );
  if (maxResults <= 0) {
    return { complete: true, count, cursor: null };
  }
  if (input.selected.provider === "gmail") {
    return await runAuthorizedGmailMailbox(
      { mailboxId: input.selected.id, userId: input.userId },
      async (accessToken) => {
        const page = await listGmailMessageIds(accessToken, {
          maxResults,
          pageToken: cursor ?? undefined,
          query: `${sent ? "in:sent" : "-in:sent -in:drafts"} before:${Math.floor(input.state.createdAt.getTime() / 1000) + 1}`,
        });
        for (let index = 0; index < page.messageIds.length; index += 4) {
          const captured = await Promise.allSettled(
            page.messageIds.slice(index, index + 4).map(async (messageId) => {
              let message: MessageListItem;
              try {
                message = await getMessageWithDetails(accessToken, messageId);
              } catch (error) {
                if (isGmailServiceError(error) && error.status === 404) {
                  return;
                }
                throw error;
              }
              await captureMailboxMessageMemory({
                actorUserId: input.userId,
                bootstrapLease: input.state.processingAt?.toISOString(),
                mailboxId: input.selected.id,
                message,
                source: "bootstrap",
              });
            })
          );
          const rejected = captured.find(
            (result) => result.status === "rejected"
          );
          if (rejected) {
            throw rejected.reason;
          }
        }
        const nextCount = count + page.messageIds.length;
        return {
          complete: !page.nextPageToken || nextCount >= BOOTSTRAP_MESSAGE_LIMIT,
          count: nextCount,
          cursor: page.nextPageToken ?? null,
        };
      }
    );
  }
  const parsedCursor =
    cursor === null ? null : managedCursorSchema.parse(JSON.parse(cursor));
  const rows = await db
    .select()
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.mailboxId, input.selected.id),
        eq(managedMailMessage.direction, sent ? "outbound" : "inbound"),
        lte(managedMailMessage.createdAt, input.state.createdAt),
        // Drafts are provisional evidence and must never seed the sent-mail voice profile.
        sent ? ne(managedMailMessage.mailboxState, "draft") : undefined,
        parsedCursor === null
          ? undefined
          : or(
              lt(managedMailMessage.sentAt, new Date(parsedCursor[0])),
              and(
                eq(managedMailMessage.sentAt, new Date(parsedCursor[0])),
                lt(managedMailMessage.id, parsedCursor[1])
              )
            )
      )
    )
    .orderBy(desc(managedMailMessage.sentAt), desc(managedMailMessage.id))
    .limit(maxResults);
  for (const message of rows) {
    await captureManagedMessageMemory({
      actorUserId: input.userId,
      bootstrapLease: input.state.processingAt?.toISOString(),
      mailboxId: input.selected.id,
      messageId: message.id,
      source: "bootstrap",
    });
  }
  const last = rows.at(-1);
  const nextCount = count + rows.length;
  return {
    complete: rows.length < maxResults || nextCount >= BOOTSTRAP_MESSAGE_LIMIT,
    count: nextCount,
    cursor: last ? JSON.stringify([last.sentAt.toISOString(), last.id]) : null,
  };
};

export const processPendingMailMemoryBootstrap = async ({
  allowLocal = false,
  limit = 2,
  userId,
}: { allowLocal?: boolean; limit?: number; userId?: string } = {}) => {
  if (serverEnv.QUIETER_DEPLOYMENT_ENV === "local" && !allowLocal) {
    return { failed: 0, processed: 0 };
  }
  const missing = await retryIdempotentDatabaseQuery(
    async () =>
      await db
        .select({
          id: mailbox.id,
          managedOwnerUserId: mailbox.managedOwnerUserId,
          ownerUserId: mailbox.ownerUserId,
          provider: mailbox.provider,
        })
        .from(mailbox)
        .leftJoin(
          aiMemoryMailboxState,
          eq(aiMemoryMailboxState.mailboxId, mailbox.id)
        )
        .leftJoin(
          aiMemoryScopeConfig,
          eq(
            aiMemoryScopeConfig.scopeKey,
            sql`'user:' || case when ${mailbox.provider} = 'gmail' then ${mailbox.ownerUserId} else ${mailbox.managedOwnerUserId} end`
          )
        )
        .where(
          and(
            eq(mailbox.status, "connected"),
            or(
              isNull(aiMemoryMailboxState.mailboxId),
              sql`${aiMemoryMailboxState.userId} is distinct from case when ${mailbox.provider} = 'gmail' then ${mailbox.ownerUserId} else ${mailbox.managedOwnerUserId} end`
            ),
            or(
              isNull(aiMemoryScopeConfig.id),
              eq(aiMemoryScopeConfig.activeLearningEnabled, true)
            ),
            or(
              and(
                eq(mailbox.provider, "gmail"),
                isNotNull(mailbox.ownerUserId),
                userId === undefined
                  ? undefined
                  : eq(mailbox.ownerUserId, userId)
              ),
              and(
                eq(mailbox.provider, "managed"),
                eq(mailbox.accessMode, "private"),
                isNotNull(mailbox.managedOwnerUserId),
                exists(
                  db
                    .select({ id: member.id })
                    .from(member)
                    .where(
                      and(
                        eq(member.userId, mailbox.managedOwnerUserId),
                        eq(member.organizationId, mailbox.organizationId)
                      )
                    )
                ),
                userId === undefined
                  ? undefined
                  : eq(mailbox.managedOwnerUserId, userId)
              )
            )
          )
        )
        .orderBy(asc(mailbox.createdAt), asc(mailbox.id))
        .limit(limit)
  );
  for (const selected of missing) {
    const ownerId =
      selected.provider === "gmail"
        ? selected.ownerUserId
        : selected.managedOwnerUserId;
    if (ownerId) {
      try {
        await queueMailboxMemoryBootstrap({
          mailboxId: selected.id,
          userId: ownerId,
        });
      } catch (error) {
        if (!(error instanceof ORPCError && error.code === "NOT_FOUND")) {
          throw error;
        }
      }
    }
  }
  const cutoff = new Date(Date.now() - BOOTSTRAP_LEASE_MS);
  const pending = await retryIdempotentDatabaseQuery(
    async () =>
      await db
        .select()
        .from(aiMemoryMailboxState)
        .where(
          and(
            exists(
              db
                .select({ id: mailbox.id })
                .from(mailbox)
                .where(
                  and(
                    eq(mailbox.id, aiMemoryMailboxState.mailboxId),
                    eq(mailbox.status, "connected")
                  )
                )
            ),
            userId === undefined
              ? undefined
              : eq(aiMemoryMailboxState.userId, userId),
            or(
              eq(aiMemoryMailboxState.status, "pending"),
              and(
                eq(aiMemoryMailboxState.status, "failed"),
                lt(aiMemoryMailboxState.updatedAt, cutoff)
              ),
              and(
                eq(aiMemoryMailboxState.status, "processing"),
                lt(aiMemoryMailboxState.processingAt, cutoff)
              )
            )
          )
        )
        .orderBy(asc(aiMemoryMailboxState.updatedAt))
        .limit(limit)
  );
  let processed = 0;
  let failed = 0;
  for (const candidate of pending) {
    const lease = new Date();
    const [state] = await db
      .update(aiMemoryMailboxState)
      .set({ processingAt: lease, status: "processing", updatedAt: lease })
      .where(
        and(
          eq(aiMemoryMailboxState.mailboxId, candidate.mailboxId),
          eq(aiMemoryMailboxState.updatedAt, candidate.updatedAt),
          eq(aiMemoryMailboxState.status, candidate.status)
        )
      )
      .returning();
    if (state === undefined || state.userId === null) {
      continue;
    }
    try {
      const selected = await assertPrivateMemoryMailbox({
        mailboxId: state.mailboxId,
        userId: state.userId,
      });
      const config = await getPersonalAiMemoryScopeConfig(state.userId);
      if (!config.activeLearningEnabled) {
        await db
          .update(aiMemoryMailboxState)
          .set({ processingAt: null, status: "pending", updatedAt: new Date() })
          .where(
            and(
              eq(aiMemoryMailboxState.mailboxId, state.mailboxId),
              eq(aiMemoryMailboxState.processingAt, lease)
            )
          );
        continue;
      }
      let { receivedComplete } = state;
      let { sentComplete } = state;
      for (const direction of ["received", "sent"] as const) {
        if (direction === "received" ? receivedComplete : sentComplete) {
          continue;
        }
        const result = await captureBootstrapDirection({
          direction,
          selected,
          state,
          userId: state.userId,
        });
        if (direction === "received") {
          receivedComplete = result.complete;
        } else {
          sentComplete = result.complete;
        }
        const [updated] = await db
          .update(aiMemoryMailboxState)
          .set({
            ...(direction === "received"
              ? {
                  receivedComplete: result.complete,
                  receivedCount: result.count,
                  receivedCursor: result.cursor,
                }
              : {
                  sentComplete: result.complete,
                  sentCount: result.count,
                  sentCursor: result.cursor,
                }),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(aiMemoryMailboxState.mailboxId, state.mailboxId),
              eq(aiMemoryMailboxState.processingAt, lease)
            )
          )
          .returning({ mailboxId: aiMemoryMailboxState.mailboxId });
        if (updated === undefined) {
          break;
        }
      }
      await db
        .update(aiMemoryMailboxState)
        .set({
          lastError: null,
          processingAt: null,
          status: receivedComplete && sentComplete ? "completed" : "pending",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(aiMemoryMailboxState.mailboxId, state.mailboxId),
            eq(aiMemoryMailboxState.processingAt, lease)
          )
        );
      processed += 1;
    } catch (error) {
      if (
        error instanceof ORPCError &&
        (error.code === "NOT_FOUND" ||
          error.code === "MAILBOX_SCOPE_REPAIR_REQUIRED")
      ) {
        await db
          .delete(aiMemoryMailboxState)
          .where(
            and(
              eq(aiMemoryMailboxState.mailboxId, state.mailboxId),
              eq(aiMemoryMailboxState.userId, state.userId),
              eq(aiMemoryMailboxState.status, "processing"),
              eq(aiMemoryMailboxState.processingAt, lease)
            )
          );
        continue;
      }
      failed += 1;
      reportError(
        new Error(
          isGmailServiceError(error)
            ? "Recent mail could not be read."
            : "Recent mail learning failed."
        ),
        {
          operation: "ai-memory:bootstrap-mail",
        }
      );
      await db
        .update(aiMemoryMailboxState)
        .set({
          lastError:
            "Recent mail could not be learned. Reconnect your mailbox if needed and try again.",
          processingAt: null,
          status: "failed",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(aiMemoryMailboxState.mailboxId, state.mailboxId),
            eq(aiMemoryMailboxState.processingAt, lease)
          )
        );
    }
  }
  return { failed, processed };
};
