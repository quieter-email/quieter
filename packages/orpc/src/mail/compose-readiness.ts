import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { gmailCredential, mailbox } from "@quieter/database/schema";
import { normalizeComposeBodyHtml } from "@quieter/mail/compose/mime";
import { getUnresolvedSnippetFields } from "@quieter/mail/compose/schema";
import type { ComposeDraftAnchor } from "@quieter/mail/compose/schema";
import { getAuthoredSnippetContent } from "@quieter/mail/compose/snippet-quotes";
import { MAILBOX_LABELS } from "@quieter/mail/messages";
import { eq } from "drizzle-orm";
import type { z } from "zod";

import {
  getAuthorizedGmailMailbox,
  REQUIRED_GMAIL_SCOPES,
} from "../gmail-mailbox-access";
import type { PreparedGmailMailboxIdentity } from "../gmail-mailbox-access";
import type { MailRequestContext } from "../gmail-request";
import { assertAgentMailboxAccess } from "../mail-agent/access";
import { assertAccessibleMailbox } from "../mailbox/service";
import { queriesMailOperations } from "./queries";
import {
  assertComposeSnippetFieldsResolved,
  hashComposeSnippetBody,
} from "./snippet-quote-provenance";
import type {
  composeSendReadinessInputSchema,
  ComposeSnippetMessage,
  ComposeSnippetQuoteProof,
} from "./snippet-quote-provenance";

export { composeSendReadinessInputSchema } from "./snippet-quote-provenance";

export const loadComposeQuoteSource = async (input: {
  anchor: ComposeDraftAnchor;
  context: MailRequestContext;
  mailboxId: string;
}): Promise<Parameters<typeof getAuthoredSnippetContent>[1] | undefined> => {
  const { context, mailboxId, anchor } = input;
  const scope = { mailboxId, userId: context.userId };
  const selected = await assertAccessibleMailbox(scope);
  if (selected.provider !== "gmail" && selected.provider !== "managed") {
    return undefined;
  }
  let gmailIdentity: PreparedGmailMailboxIdentity | undefined;
  if (selected.provider === "gmail") {
    const prepared = await getAuthorizedGmailMailbox(scope);
    gmailIdentity = context.gmailIdentity ?? {
      googleSubject: prepared.mailbox.googleSubject,
      mailboxId: prepared.mailbox.id,
    };
    if (
      gmailIdentity.mailboxId !== mailboxId ||
      gmailIdentity.googleSubject !== prepared.mailbox.googleSubject
    ) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "Your inbox connection changed. Try again.",
      });
    }
  }
  context.signal?.throwIfAborted();
  let source: Parameters<typeof getAuthoredSnippetContent>[1] | undefined;
  try {
    const thread = await queriesMailOperations.getThread({
      context: { ...context, gmailIdentity },
      input: { mailboxId, threadId: anchor.sourceThreadId },
      recordActivity: false,
    });
    const message = thread.messages.find(
      (item) =>
        item.id === anchor.sourceMessageId &&
        item.threadId === anchor.sourceThreadId &&
        item.draftId === undefined &&
        item.labelIds?.includes(MAILBOX_LABELS.drafts) !== true
    );
    if (thread.threadId === anchor.sourceThreadId && message !== undefined) {
      source = {
        bodyHtml: message.bodyHtml,
        bodyText: message.bodyText,
        cc: message.cc,
        date: message.date,
        from: message.from,
        id: message.id,
        internalDate: message.internalDate,
        snippet: message.snippet,
        subject: message.subject,
        threadId: message.threadId,
        to: message.to,
      };
    }
  } catch (error) {
    if (!(error instanceof ORPCError) || error.code !== "NOT_FOUND") {
      throw error;
    }
  }
  context.signal?.throwIfAborted();
  await db.transaction(async (transaction) => {
    const [current] = await transaction
      .select({ provider: mailbox.provider, status: mailbox.status })
      .from(mailbox)
      .where(eq(mailbox.id, mailboxId))
      .for("update");
    const access = await assertAgentMailboxAccess(scope, transaction);
    if (
      current?.provider !== selected.provider ||
      access.provider !== selected.provider
    ) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "Your inbox connection changed. Try again.",
      });
    }
    if (gmailIdentity !== undefined) {
      const [credential] = await transaction
        .select({
          googleSubject: gmailCredential.googleSubject,
          scopes: gmailCredential.scopes,
        })
        .from(gmailCredential)
        .where(eq(gmailCredential.mailboxId, mailboxId))
        .for("no key update");
      const scopes = new Set(credential?.scopes.split(/\s+/u));
      if (
        current.status !== "connected" ||
        credential?.googleSubject !== gmailIdentity.googleSubject ||
        !REQUIRED_GMAIL_SCOPES.every((required) => scopes.has(required))
      ) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Your inbox connection changed. Try again.",
        });
      }
    }
    context.signal?.throwIfAborted();
  });
  context.signal?.throwIfAborted();
  return source;
};

const getComposeSnippetProjection = async (input: {
  context: MailRequestContext;
  mailboxId: string;
  message: ComposeSnippetMessage;
}) => {
  input.context.signal?.throwIfAborted();
  const message = {
    ...input.message,
    bodyHtml: normalizeComposeBodyHtml(input.message),
  };
  await assertAccessibleMailbox({
    mailboxId: input.mailboxId,
    userId: input.context.userId,
  });
  input.context.signal?.throwIfAborted();
  const fields = getUnresolvedSnippetFields(message);
  if (
    fields.length === 0 ||
    message.draftAnchor === null ||
    message.draftAnchor === undefined
  ) {
    return {
      authoredBodyHtml: message.bodyHtml,
      authoredBodyText: message.bodyText,
      source: undefined,
    };
  }
  const source = await loadComposeQuoteSource({
    anchor: message.draftAnchor,
    context: input.context,
    mailboxId: input.mailboxId,
  });
  return {
    ...(source === undefined
      ? {
          authoredBodyHtml: message.bodyHtml,
          authoredBodyText: message.bodyText,
        }
      : getAuthoredSnippetContent(message, source)),
    source,
  };
};

export const getComposeSendReadiness = async ({
  context,
  input,
}: {
  context: MailRequestContext;
  input: z.infer<typeof composeSendReadinessInputSchema>;
}): Promise<{ unresolvedSnippetFields: string[] }> => {
  const projection = await getComposeSnippetProjection({
    context,
    mailboxId: input.mailboxId,
    message: input,
  });
  return {
    unresolvedSnippetFields: getUnresolvedSnippetFields({
      bodyHtml: projection.authoredBodyHtml,
      bodyText: projection.authoredBodyText,
    }),
  };
};

export const prepareComposeSnippetAdmission = async (input: {
  context: MailRequestContext;
  mailboxId: string;
  message: ComposeSnippetMessage;
  sendOperationId: string;
}): Promise<ComposeSnippetQuoteProof | undefined> => {
  const projection = await getComposeSnippetProjection(input);
  const anchor = input.message.draftAnchor;
  const snippetQuote: ComposeSnippetQuoteProof | undefined =
    projection.source === undefined || anchor === null || anchor === undefined
      ? undefined
      : {
          actorUserId: input.context.userId,
          authoredBodyHtml: projection.authoredBodyHtml,
          authoredBodyText: projection.authoredBodyText,
          bodyHash: hashComposeSnippetBody(input.message),
          mailboxId: input.mailboxId,
          sendOperationId: input.sendOperationId,
          source: {
            mailboxId: input.mailboxId,
            messageId: projection.source.id,
            seededBy: anchor.seededBy,
            threadId: projection.source.threadId,
          },
          version: 1,
        };
  assertComposeSnippetFieldsResolved({
    actorUserId: input.context.userId,
    mailboxId: input.mailboxId,
    message: input.message,
    sendOperationId: input.sendOperationId,
    snippetQuote,
  });
  return snippetQuote;
};
