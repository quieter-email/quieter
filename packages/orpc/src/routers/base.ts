import { ORPCError, os } from "@orpc/server";
import { auth } from "@quieter/auth";
import { isGmailRateLimitedError, isGmailServiceError, type MailboxCategory } from "@quieter/gmail";
import { z } from "zod";
import { getRequestHeaders, type OrpcContext } from "../context";
import { orpcErrorMap } from "../errors";
import { getAuthorizedGmailMailbox, refreshAuthorizedGmailAccessToken } from "../mailbox";

export const base = os.errors(orpcErrorMap).$context<OrpcContext>();
export const publicProcedure = base;

export type ProtectedContext = OrpcContext & {
  user: {
    email: string;
    id: string;
    name: string;
  };
  userId: string;
};

export const protectedProcedure = base.use(async ({ context, errors, next }) => {
  const headers = getRequestHeaders(context);
  const session = await auth.api.getSession({ headers });

  if (!session?.user || !session.session) {
    throw errors.UNAUTHORIZED();
  }

  return next({
    context: {
      ...context,
      user: {
        email: session.user.email,
        id: session.user.id,
        name: session.user.name,
      },
      userId: session.user.id,
    },
  });
});

export const mailboxCategorySchema = z.enum([
  "inbox",
  "unread",
  "spam",
  "sent",
  "trash",
  "drafts",
] satisfies readonly MailboxCategory[]);

export const historySyncMailboxCategorySchema = z.enum([
  "inbox",
  "unread",
  "spam",
  "sent",
  "trash",
]);
export const mailboxIdSchema = z.string().trim().min(1);
export const gmailUserLabelNameSchema = z.string().trim().min(1).max(225);
export const mailboxSwitcherOrderSchema = z.object({
  groupIds: z.array(z.string().trim().min(1)),
  mailboxIdsByGroupId: z.record(z.string().trim().min(1), z.array(z.string().trim().min(1))),
});

const toRetryAfterSeconds = (retryAfterMs?: number) =>
  Math.max(1, Math.ceil((retryAfterMs ?? 1000) / 1000));

const rethrowKnownRateLimit = (context: OrpcContext, error: unknown): never => {
  if (!isGmailRateLimitedError(error)) {
    throw error;
  }

  const retryAfter = toRetryAfterSeconds(error.retryAfterMs);
  context.resHeaders?.set("retry-after", String(retryAfter));

  throw new ORPCError("RATE_LIMITED", {
    data: {
      provider: "gmail",
      retryAfter,
    },
    message: error.message,
    status: 429,
  });
};

export const callWithRateLimitHandling = async <TValue>(
  context: OrpcContext,
  callback: () => Promise<TValue>,
): Promise<TValue> => {
  try {
    return await callback();
  } catch (error) {
    return rethrowKnownRateLimit(context, error);
  }
};

const isGmailAuthError = (error: unknown) =>
  isGmailServiceError(error) &&
  error.status === 401 &&
  ((typeof error.googleReason === "string" && error.googleReason.toLowerCase() === "autherror") ||
    (typeof error.googleStatus === "string" &&
      error.googleStatus.toUpperCase() === "UNAUTHENTICATED"));

export const callGmail = async <TValue>(
  context: ProtectedContext,
  mailboxId: string,
  runner: (accessToken: string, signal?: AbortSignal) => Promise<TValue>,
): Promise<TValue> => {
  const headers = getRequestHeaders(context);
  const { accessToken, mailbox } = await getAuthorizedGmailMailbox({
    headers,
    mailboxId,
    userId: context.userId,
  });

  try {
    return await runner(accessToken, context.signal);
  } catch (error) {
    if (!isGmailAuthError(error)) {
      return rethrowKnownRateLimit(context, error);
    }

    const refreshedAccessToken = await refreshAuthorizedGmailAccessToken({
      emailAddress: mailbox.emailAddress,
      headers,
      mailboxId: mailbox.id,
      providerAccountId: mailbox.providerAccountId,
      userId: mailbox.connectedUserId,
    });

    try {
      return await runner(refreshedAccessToken, context.signal);
    } catch (retryError) {
      return rethrowKnownRateLimit(context, retryError);
    }
  }
};
