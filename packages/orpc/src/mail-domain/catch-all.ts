import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { mailbox, mailDomain } from "@quieter/database/schema";
import { and, eq, isNull, or } from "drizzle-orm";

import { MAILBOX_PROVIDER_MANAGED } from "../mailbox/access";

export type MailDomainCatchAll = {
  emailAddress: string;
  mailboxId: string;
  pattern: string;
};

export const setMailDomainCatchAll = async (input: {
  domainId: string;
  mailboxId: string | null;
  organizationId: string;
}): Promise<{ catchAll: MailDomainCatchAll | null }> =>
  await db.transaction(async (tx) => {
    const [storedDomain] = await tx
      .select({
        domain: mailDomain.domain,
        id: mailDomain.id,
        mode: mailDomain.mode,
        status: mailDomain.status,
      })
      .from(mailDomain)
      .where(
        and(
          eq(mailDomain.id, input.domainId),
          eq(mailDomain.organizationId, input.organizationId)
        )
      )
      .limit(1)
      .for("update");
    if (storedDomain === undefined) {
      throw new ORPCError("NOT_FOUND", {
        message: "Mail domain was not found in the active team.",
      });
    }

    const now = new Date();
    if (input.mailboxId === null) {
      await tx
        .update(mailDomain)
        .set({ catchAllMailboxId: null, updatedAt: now })
        .where(eq(mailDomain.id, storedDomain.id));
      return { catchAll: null };
    }

    const [targetMailbox] = await tx
      .select({
        emailAddress: mailbox.emailAddress,
        id: mailbox.id,
        organizationId: mailbox.organizationId,
        provider: mailbox.provider,
      })
      .from(mailbox)
      .where(eq(mailbox.id, input.mailboxId))
      .limit(1);
    if (
      targetMailbox === undefined ||
      targetMailbox.organizationId !== input.organizationId ||
      targetMailbox.provider !== MAILBOX_PROVIDER_MANAGED
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Shared inbox was not found in the active team.",
      });
    }
    if (
      storedDomain.mode !== "send_and_receive" ||
      storedDomain.status !== "verified"
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "Whole-domain inboxes require a verified domain with incoming mail enabled.",
      });
    }
    const targetDomain = targetMailbox.emailAddress
      .split("@")[1]
      ?.trim()
      .toLowerCase();
    if (targetDomain !== storedDomain.domain) {
      throw new ORPCError("BAD_REQUEST", {
        message: "The shared inbox address must use this domain.",
      });
    }

    const [claimedDomain] = await tx
      .update(mailDomain)
      .set({ catchAllMailboxId: input.mailboxId, updatedAt: now })
      .where(
        and(
          eq(mailDomain.id, storedDomain.id),
          eq(mailDomain.organizationId, input.organizationId),
          eq(mailDomain.mode, "send_and_receive"),
          eq(mailDomain.status, "verified"),
          or(
            isNull(mailDomain.catchAllMailboxId),
            eq(mailDomain.catchAllMailboxId, input.mailboxId)
          )
        )
      )
      .returning({ id: mailDomain.id });
    if (claimedDomain === undefined) {
      throw new ORPCError("CONFLICT", {
        message: `Incoming mail is no longer available for ${storedDomain.domain}, or another shared inbox already receives every address. Refresh and try again.`,
      });
    }

    return {
      catchAll: {
        emailAddress: targetMailbox.emailAddress,
        mailboxId: input.mailboxId,
        pattern: `*@${storedDomain.domain}`,
      },
    };
  });
