import { ORPCError } from "@orpc/server";
import { matchesHistoryCorrespondent } from "@quieter/mail/correspondent-history";
import type { ThreadMessagesResult } from "@quieter/mail/messages";

import { loadAiAgentContext } from "../ai-memory-context";
import type { MailRequestContext } from "../gmail-request";
import { queriesMailOperations } from "../mail/queries";
import { assertAccessibleMailbox } from "../mailbox/service";
import { listReminders } from "../reminders/service";
import { correspondentCursorSchema } from "./contracts";
import type {
  CorrespondentCursor,
  CorrespondentHistoryInput,
  CorrespondentHistoryPage,
  OpenCorrespondentSourceInput,
  OpenedCorrespondentSource,
} from "./contracts";

const encodeCursor = (cursor: CorrespondentCursor): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  return btoa(String.fromCodePoint(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
};

const decodeCursor = (value: string): CorrespondentCursor => {
  try {
    if (!/^[\w-]+$/u.test(value)) {
      throw new Error("Invalid cursor encoding.");
    }
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    if (
      btoa(binary)
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "") !== value
    ) {
      throw new Error("Invalid cursor encoding.");
    }
    const bytes = Uint8Array.from(
      binary,
      (character) => character.codePointAt(0) ?? 0
    );
    const cursor = correspondentCursorSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    );
    return cursor;
  } catch (error) {
    throw new ORPCError("BAD_REQUEST", {
      cause: error,
      message: "This history continuation is no longer valid.",
    });
  }
};

const assertHistoryAccess = async ({
  context,
  mailboxId,
}: {
  context: MailRequestContext;
  mailboxId: string;
}) => {
  context.signal?.throwIfAborted();
  await assertAccessibleMailbox({ mailboxId, userId: context.userId });
  context.signal?.throwIfAborted();
};

const loadHistoryThread = async ({
  context,
  mailboxId,
  threadId,
}: {
  context: MailRequestContext;
  mailboxId: string;
  threadId: string;
}): Promise<ThreadMessagesResult> => {
  await assertHistoryAccess({ context, mailboxId });
  try {
    return await queriesMailOperations.getThread({
      context,
      input: { mailboxId, threadId },
      recordActivity: false,
    });
  } finally {
    await assertHistoryAccess({ context, mailboxId });
  }
};

export const listCorrespondentHistory = async ({
  context,
  input,
}: {
  context: MailRequestContext;
  input: CorrespondentHistoryInput;
}): Promise<CorrespondentHistoryPage> => {
  const cursor = input.cursor === undefined ? null : decodeCursor(input.cursor);
  if (
    cursor !== null &&
    (cursor.actorId !== context.userId ||
      cursor.mailboxId !== input.mailboxId ||
      cursor.correspondentEmail !== input.correspondentEmail ||
      cursor.section !== input.section)
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This history continuation belongs to another selection.",
    });
  }
  const selection = {
    correspondentEmail: input.correspondentEmail,
    mailboxId: input.mailboxId,
  };
  const cursorScope = { ...selection, actorId: context.userId };
  await assertHistoryAccess({ context, mailboxId: input.mailboxId });

  switch (input.section) {
    case "mail": {
      const page = await queriesMailOperations.listThreads({
        context,
        input: {
          category: "inbox",
          correspondentEmail: input.correspondentEmail,
          mailboxId: input.mailboxId,
          maxResults: 10,
          pageToken: cursor?.section === "mail" ? cursor.position : undefined,
          scope: "all_mail",
        },
      });
      await assertHistoryAccess({ context, mailboxId: input.mailboxId });
      if (
        page.messages.some(
          (message) =>
            !matchesHistoryCorrespondent(message, input.correspondentEmail)
        )
      ) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "History could not be loaded. Please try again.",
        });
      }
      return {
        ...selection,
        items: page.messages.map((message) => ({
          message,
          source: message.sourceRevision
            ? {
                kind: "mail",
                messageId: message.id,
                revision: message.sourceRevision,
                threadId: message.threadId,
              }
            : null,
        })),
        nextCursor: page.nextPageToken
          ? encodeCursor({
              ...cursorScope,
              position: page.nextPageToken,
              section: "mail",
            })
          : null,
        section: "mail",
      };
    }
    case "memory": {
      const page = await loadAiAgentContext({
        mailboxId: input.mailboxId,
        overview: {
          correspondentEmail: input.correspondentEmail,
          cursor: cursor?.section === "memory" ? cursor.position : undefined,
        },
        userId: context.userId,
      });
      await assertHistoryAccess({ context, mailboxId: input.mailboxId });
      return {
        ...selection,
        items: page.items,
        nextCursor: page.nextCursor
          ? encodeCursor({
              ...cursorScope,
              position: page.nextCursor,
              section: "memory",
            })
          : null,
        section: "memory",
      };
    }
    case "commitments": {
      const page = await listReminders({
        cursor: cursor?.section === "commitments" ? cursor.position : undefined,
        mailboxId: input.mailboxId,
        userId: context.userId,
        view: "active",
      });
      await assertHistoryAccess({ context, mailboxId: input.mailboxId });
      const items: Extract<
        CorrespondentHistoryPage,
        { section: "commitments" }
      >["items"] = [];
      const threads = new Map<string, ThreadMessagesResult | null>();
      const processed = page.items.slice(0, 5);
      for (const reminder of processed) {
        context.signal?.throwIfAborted();
        if (reminder.target.kind !== "thread") {
          continue;
        }
        const { threadId, anchorMessageId } = reminder.target;
        if (!threads.has(threadId)) {
          try {
            threads.set(
              threadId,
              await loadHistoryThread({
                context,
                mailboxId: input.mailboxId,
                threadId,
              })
            );
          } catch (error) {
            if (!(error instanceof ORPCError) || error.code !== "NOT_FOUND") {
              throw error;
            }
            await assertHistoryAccess({ context, mailboxId: input.mailboxId });
            threads.set(threadId, null);
          }
        }
        const thread = threads.get(threadId);
        const anchor =
          thread?.threadId === threadId
            ? thread.messages.find(
                (message) =>
                  message.id === anchorMessageId &&
                  message.threadId === threadId
              )
            : undefined;
        if (
          anchor === undefined ||
          !matchesHistoryCorrespondent(anchor, input.correspondentEmail)
        ) {
          continue;
        }
        items.push({
          reminder,
          source: anchor.sourceRevision
            ? {
                kind: "mail",
                messageId: anchor.id,
                revision: anchor.sourceRevision,
                threadId,
              }
            : null,
        });
      }
      const nextPosition =
        page.items.length > processed.length
          ? (processed.at(-1)?.id ?? null)
          : page.nextCursor;
      await assertHistoryAccess({ context, mailboxId: input.mailboxId });
      return {
        ...selection,
        items,
        nextCursor: nextPosition
          ? encodeCursor({
              ...cursorScope,
              position: nextPosition,
              section: "commitments",
            })
          : null,
        section: "commitments",
      };
    }
    default: {
      const exhaustive: never = input.section;
      return exhaustive;
    }
  }
};

export const openCorrespondentSource = async ({
  context,
  input,
}: {
  context: MailRequestContext;
  input: OpenCorrespondentSourceInput;
}): Promise<OpenedCorrespondentSource> => {
  const thread = await loadHistoryThread({
    context,
    mailboxId: input.mailboxId,
    threadId: input.source.threadId,
  });
  const message =
    thread.threadId === input.source.threadId
      ? thread.messages.find(
          (candidate) =>
            candidate.id === input.source.messageId &&
            candidate.threadId === input.source.threadId
        )
      : undefined;
  if (
    message === undefined ||
    !matchesHistoryCorrespondent(message, input.correspondentEmail)
  ) {
    throw new ORPCError("NOT_FOUND", {
      message: "This source is no longer available.",
    });
  }
  if (
    !message.sourceRevision ||
    message.sourceRevision !== input.source.revision
  ) {
    throw new ORPCError("CONFLICT", {
      message: "This source has changed. Refresh the history and try again.",
    });
  }
  return { messageId: message.id, thread };
};
