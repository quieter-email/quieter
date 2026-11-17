import { ORPCError } from "@orpc/server";

import type { MailRequestContext } from "../gmail-request";
import { getAuthorizedManagedMailbox } from "../mailbox/access";
import { assertAccessibleMailbox } from "../mailbox/service";

export const authorizeMailPlacement = async (
  context: MailRequestContext,
  mailboxId: string
) => {
  const selected = await assertAccessibleMailbox({
    mailboxId,
    userId: context.userId,
  });
  if (selected.provider === "managed") {
    await getAuthorizedManagedMailbox({
      mailboxId,
      requiredRoles: ["manager", "responder"],
      userId: context.userId,
    });
  } else if (selected.provider !== "gmail") {
    throw new ORPCError("FORBIDDEN", {
      message: "You cannot change placement in this inbox.",
    });
  }
  return selected;
};
