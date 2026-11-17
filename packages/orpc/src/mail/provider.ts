import { ORPCError } from "@orpc/server";
import type { MailboxProvider } from "@quieter/mail/search";

export const assertMailWriteProvider: (
  provider: MailboxProvider
) => asserts provider is "gmail" | "managed" = (provider) => {
  if (provider === "gmail" || provider === "managed") {
    return;
  }
  throw new ORPCError("FORBIDDEN", { message: "This mailbox is read-only." });
};
