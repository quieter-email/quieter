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
}): Promise<{ catchAll: MailDomainCatchAll | null }> => {
  const [storedDomain] = await db
    .select({
      domain: mailDomain.domain,
      id: mailDomain.id,
    })
    .from(mailDomain)
    .where(
      and(
        eq(mailDomain.id, input.domainId),
        eq(mailDomain.organizationId, input.organizationId)
      )
    )
    .limit(1);
  if (storedDomain === undefined) {
    throw new ORPCError("NOT_FOUND", {
      message: "Mail domain was not found in the active team.",
    });
  }

  const now = new Date();
  if (input.mailboxId === null) {
    await db
      .update(mailDomain)
      .set({ catchAllMailboxId: null, updatedAt: now })
      .where(eq(mailDomain.id, storedDomain.id));
    return { catchAll: null };
  }

  const [eligibility] = await db
    .select({
      mode: mailDomain.mode,
      status: mailDomain.status,
      targetEmailAddress: mailbox.emailAddress,
      targetOrganizationId: mailbox.organizationId,
      targetProvider: mailbox.provider,
    })
    .from(mailDomain)
    .innerJoin(mailbox, eq(mailbox.id, input.mailboxId))
    .where(eq(mailDomain.id, storedDomain.id))
    .limit(1);
  if (
    eligibility?.targetOrganizationId !== input.organizationId ||
    eligibility.targetProvider !== MAILBOX_PROVIDER_MANAGED
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Shared inbox was not found in the active team.",
    });
  }
  if (
    eligibility.mode !== "send_and_receive" ||
    eligibility.status !== "verified"
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Whole-domain inboxes require a verified domain with incoming mail enabled.",
    });
  }
  const targetDomain = eligibility.targetEmailAddress
    .split("@")[1]
    ?.trim()
    .toLowerCase();
  if (targetDomain !== storedDomain.domain) {
    throw new ORPCError("BAD_REQUEST", {
      message: "The shared inbox address must use this domain.",
    });
  }

  const [claimedDomain] = await db
    .update(mailDomain)
    .set({ catchAllMailboxId: input.mailboxId, updatedAt: now })
    .where(
      and(
        eq(mailDomain.id, storedDomain.id),
        or(
          isNull(mailDomain.catchAllMailboxId),
          eq(mailDomain.catchAllMailboxId, input.mailboxId)
        )
      )
    )
    .returning({ id: mailDomain.id });
  if (claimedDomain === undefined) {
    throw new ORPCError("CONFLICT", {
      message: `Another shared inbox already receives every address on ${storedDomain.domain}. Remove that whole-domain inbox first.`,
    });
  }

  return {
    catchAll: {
      emailAddress: eligibility.targetEmailAddress,
      mailboxId: input.mailboxId,
      pattern: `*@${storedDomain.domain}`,
    },
  };
};
