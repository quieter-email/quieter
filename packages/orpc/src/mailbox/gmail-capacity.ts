import { ORPCError } from "@orpc/server";
import { getOrganizationBillingEntitlement } from "@quieter/billing/entitlements";
import { GMAIL_MAILBOX_LIMITS } from "@quieter/billing/plans";
import { db } from "@quieter/database/client";
import type { DatabaseTransaction } from "@quieter/database/client";
import { mailbox, member, organization } from "@quieter/database/schema";
import { and, count, eq } from "drizzle-orm";

export const getGmailMailboxCapacity = async (organizationId: string) => {
  const entitlement = await getOrganizationBillingEntitlement({
    feature: "organizationMail",
    organizationId,
  });
  const plan = entitlement.product ?? "free";
  const [usage] = await db
    .select({ count: count() })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.organizationId, organizationId),
        eq(mailbox.provider, "gmail")
      )
    );
  return { limit: GMAIL_MAILBOX_LIMITS[plan], used: usage?.count ?? 0 };
};

export const withGmailMailboxCapacity = async <Result>(
  input: { organizationId: string; userId: string; mailboxId: string | null },
  run: (database: DatabaseTransaction) => Promise<Result>
) => {
  const { limit } = await getGmailMailboxCapacity(input.organizationId);
  return await db.transaction(async (database) => {
    const [team] = await database
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, input.organizationId))
      .for("update");
    const [membership] = await database
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, input.organizationId),
          eq(member.userId, input.userId)
        )
      );
    if (team === undefined || membership === undefined) {
      throw new ORPCError("FORBIDDEN", {
        message: "You no longer have access to this team.",
      });
    }
    const [existing] =
      input.mailboxId === null
        ? []
        : await database
            .select({
              organizationId: mailbox.organizationId,
              ownerUserId: mailbox.ownerUserId,
              provider: mailbox.provider,
            })
            .from(mailbox)
            .where(eq(mailbox.id, input.mailboxId))
            .for("update");
    if (
      input.mailboxId !== null &&
      (existing === undefined ||
        existing.ownerUserId !== input.userId ||
        existing.provider !== "gmail")
    ) {
      throw new ORPCError("NOT_FOUND", { message: "Gmail mailbox not found." });
    }
    if (existing?.organizationId !== input.organizationId) {
      const [usage] = await database
        .select({ count: count() })
        .from(mailbox)
        .where(
          and(
            eq(mailbox.organizationId, input.organizationId),
            eq(mailbox.provider, "gmail")
          )
        );
      if ((usage?.count ?? 0) >= limit) {
        throw new ORPCError("FORBIDDEN", {
          message: `This team has reached its limit of ${limit} Gmail accounts. Disconnect an account or upgrade your plan.`,
        });
      }
    }
    return await run(database);
  });
};
