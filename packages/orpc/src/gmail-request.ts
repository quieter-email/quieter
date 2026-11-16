import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import type { DatabaseTransaction } from "@quieter/database/client";
import { gmailCredential, mailbox } from "@quieter/database/schema";
import { isGmailRateLimitedError } from "@quieter/gmail";
import { eq } from "drizzle-orm";

import { assertAiAuthority } from "./ai-authority";
import type { AiOperationOrigin } from "./ai-authority";
import type { OrpcContext } from "./context";
import {
  REQUIRED_GMAIL_SCOPES,
  runAuthorizedGmailMailbox,
} from "./gmail-mailbox-access";
import type { PreparedGmailMailboxIdentity } from "./gmail-mailbox-access";
import { assertAgentMailboxAccess } from "./mail-agent/access";
import { assertPrivateMailContext } from "./mail/private-context";
import type { ComposeSnippetQuoteProof } from "./mail/snippet-quote-provenance";

export type MailEffectAssertion = (
  database?: Pick<typeof db, "select">
) => Promise<void>;

export type MailRequestContext = Pick<
  OrpcContext,
  "signal" | "resHeaders" | "scheduleBackgroundTask"
> & {
  beforeEffect?: MailEffectAssertion;
  gmailIdentity?: PreparedGmailMailboxIdentity;
  origin?: AiOperationOrigin;
  privateContext?: boolean;
  retryUnauthorized?: boolean;
  snippetQuote?: ComposeSnippetQuoteProof;
  userId: string;
};

export const assertMailWriteAccess = async (
  input: {
    gmailIdentity?: PreparedGmailMailboxIdentity;
    mailboxId: string;
    userId: string;
  },
  database: Pick<typeof db, "select"> = db,
  options?: { providerWrite: boolean }
): Promise<void> => {
  await assertAgentMailboxAccess(
    { mailboxId: input.mailboxId, saveDraft: true, userId: input.userId },
    database
  );
  const [current] = await database
    .select({ provider: mailbox.provider, status: mailbox.status })
    .from(mailbox)
    .where(eq(mailbox.id, input.mailboxId))
    .limit(1);
  if (current === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Inbox not found." });
  }
  if (
    input.gmailIdentity !== undefined &&
    (input.gmailIdentity.mailboxId !== input.mailboxId ||
      current.provider !== "gmail")
  ) {
    throw new ORPCError("UNAUTHORIZED", {
      message:
        "Your inbox connection changed. Start a new request to continue.",
    });
  }
  if (
    current.provider === "gmail" &&
    (options?.providerWrite !== false || input.gmailIdentity !== undefined)
  ) {
    const [credential] = await database
      .select({
        googleSubject: gmailCredential.googleSubject,
        scopes: gmailCredential.scopes,
      })
      .from(gmailCredential)
      .where(eq(gmailCredential.mailboxId, input.mailboxId))
      .for("no key update");
    if (
      input.gmailIdentity !== undefined &&
      credential?.googleSubject !== input.gmailIdentity.googleSubject
    ) {
      throw new ORPCError("UNAUTHORIZED", {
        message:
          "Your inbox connection changed. Start a new request to continue.",
      });
    }
    const scopes = new Set(credential?.scopes.split(/\s+/u));
    if (
      options?.providerWrite !== false &&
      (current.status !== "connected" ||
        !REQUIRED_GMAIL_SCOPES.every((scope) => scopes.has(scope)))
    ) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "Reconnect your inbox before making changes.",
      });
    }
  }
};

export const assertMailEffectAllowed = async (
  context: MailRequestContext,
  mailboxId: string,
  transaction?: DatabaseTransaction,
  options?: { providerWrite: boolean }
): Promise<void> => {
  try {
    context.signal?.throwIfAborted();
    if (transaction === undefined) {
      await db.transaction(async (database) => {
        await assertMailEffectAllowed(context, mailboxId, database, options);
      });
      context.signal?.throwIfAborted();
      return;
    }
    const database = transaction;
    await database
      .select({ id: mailbox.id })
      .from(mailbox)
      .where(eq(mailbox.id, mailboxId))
      .for("update");
    await context.beforeEffect?.(database);
    if (
      context.origin?.kind === "ai" &&
      typeof context.privateContext !== "boolean"
    ) {
      throw new ORPCError("FORBIDDEN", {
        message:
          "The context for this assistant action could not be verified. Start a new request.",
      });
    }
    if (context.origin !== undefined) {
      await assertAiAuthority(
        {
          effect: "write",
          mailboxId,
          origin: context.origin,
          userId: context.userId,
        },
        database
      );
    }
    await assertMailWriteAccess(
      {
        gmailIdentity: context.gmailIdentity,
        mailboxId,
        userId: context.userId,
      },
      database,
      options
    );
    await assertPrivateMailContext(database, {
      mailboxId,
      privateContext:
        context.origin?.kind === "ai" && context.privateContext === true,
      userId: context.userId,
    });
    context.signal?.throwIfAborted();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ORPCError("CONFLICT", {
        cause: error,
        data: { sendNotStarted: true },
        message: "This action was cancelled.",
      });
    }
    const previous = error instanceof ORPCError ? error : undefined;
    const data: unknown = previous?.data;
    throw new ORPCError(previous?.code ?? "INTERNAL_SERVER_ERROR", {
      cause: error,
      data: {
        ...(typeof data === "object" && data !== null ? data : {}),
        sendNotStarted: true,
      },
      message:
        previous?.message ?? "This action could not be authorized. Try again.",
      status: previous?.status ?? 500,
    });
  }
};

export const callGmail = async <T>(
  context: MailRequestContext,
  mailboxId: string,
  operation: (
    accessToken: string,
    signal: AbortSignal | undefined,
    beforeEffect: () => Promise<void>,
    gmailIdentity: PreparedGmailMailboxIdentity
  ) => Promise<T>,
  options?: { kind: "send" }
): Promise<T> => {
  let operationStarted = false;
  const authorizationStartedAt = performance.now();
  try {
    return await runAuthorizedGmailMailbox(
      {
        mailboxId,
        retryUnauthorized: context.retryUnauthorized,
        userId: context.userId,
      },
      async (token, identity) => {
        const gmailIdentity = context.gmailIdentity ?? identity;
        if (!operationStarted) {
          context.resHeaders?.append(
            "Server-Timing",
            `mail_authorization;dur=${(performance.now() - authorizationStartedAt).toFixed(1)}`
          );
        }
        operationStarted = true;
        const providerStartedAt = performance.now();
        try {
          return await operation(
            token,
            context.signal,
            async () => {
              await assertMailEffectAllowed(
                { ...context, gmailIdentity },
                mailboxId
              );
            },
            gmailIdentity
          );
        } finally {
          context.resHeaders?.append(
            "Server-Timing",
            `mail_provider;dur=${(performance.now() - providerStartedAt).toFixed(1)}`
          );
        }
      }
    );
  } catch (error) {
    let failure: unknown = error;
    if (isGmailRateLimitedError(error)) {
      const retryAfter = Math.max(
        1,
        Math.ceil((error.retryAfterMs ?? 1000) / 1000)
      );
      context.resHeaders?.set("retry-after", String(retryAfter));
      failure = new ORPCError("RATE_LIMITED", {
        data: { provider: "gmail", retryAfter },
        message: "Your mailbox is busy. Please try again shortly.",
        status: 429,
      });
    }
    if (options?.kind === "send" && !operationStarted) {
      const previous = failure instanceof ORPCError ? failure : undefined;
      const data: unknown = previous?.data;
      throw new ORPCError(previous?.code ?? "INTERNAL_SERVER_ERROR", {
        cause: failure,
        data: {
          ...(typeof data === "object" && data !== null ? data : {}),
          sendNotStarted: true,
        },
        defined: previous?.defined,
        message:
          failure instanceof Error
            ? failure.message
            : "The message could not be prepared for sending.",
        status: previous?.status ?? 500,
      });
    }
    throw failure;
  }
};
