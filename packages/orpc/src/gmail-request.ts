import { ORPCError } from "@orpc/server";
import { isGmailRateLimitedError } from "@quieter/gmail";

import type { OrpcContext } from "./context";
import { runAuthorizedGmailMailbox } from "./gmail-mailbox-access";

export type MailRequestContext = Pick<
  OrpcContext,
  "signal" | "resHeaders" | "scheduleBackgroundTask"
> & {
  retryUnauthorized?: boolean;
  userId: string;
};

export const callGmail = async <T>(
  context: MailRequestContext,
  mailboxId: string,
  operation: (accessToken: string, signal?: AbortSignal) => Promise<T>,
  options?: { kind: "send" }
): Promise<T> => {
  let operationStarted = false;
  try {
    return await runAuthorizedGmailMailbox(
      {
        mailboxId,
        retryUnauthorized: context.retryUnauthorized,
        userId: context.userId,
      },
      async (token) => {
        operationStarted = true;
        return await operation(token, context.signal);
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
