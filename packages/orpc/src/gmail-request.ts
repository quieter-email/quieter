import { ORPCError } from "@orpc/server";
import { isGmailRateLimitedError } from "@quieter/gmail";

import type { OrpcContext } from "./context";
import { runAuthorizedGmailMailbox } from "./gmail-mailbox-access";

export type MailRequestContext = Pick<OrpcContext, "signal" | "resHeaders"> & {
  userId: string;
};

export const callGmail = async <T>(
  context: MailRequestContext,
  mailboxId: string,
  operation: (accessToken: string, signal?: AbortSignal) => Promise<T>
): Promise<T> => {
  try {
    return await runAuthorizedGmailMailbox(
      { mailboxId, userId: context.userId },
      async (token) => await operation(token, context.signal)
    );
  } catch (error) {
    if (!isGmailRateLimitedError(error)) {
      throw error;
    }
    const retryAfter = Math.max(
      1,
      Math.ceil((error.retryAfterMs ?? 1000) / 1000)
    );
    context.resHeaders?.set("retry-after", String(retryAfter));
    throw new ORPCError("RATE_LIMITED", {
      data: { provider: "gmail", retryAfter },
      message: error.message,
      status: 429,
    });
  }
};
