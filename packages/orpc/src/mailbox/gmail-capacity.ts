import { ORPCError } from "@orpc/server";
import { getOrganizationBillingEntitlement } from "@quieter/billing/entitlements";
import { GMAIL_MAILBOX_LIMITS } from "@quieter/billing/plans";
import { db } from "@quieter/database/client";
import type { DatabaseTransaction } from "@quieter/database/client";
import { mailbox, member, organization } from "@quieter/database/schema";
import { and, count, eq, inArray, sql } from "drizzle-orm";

export const getExternalMailboxCapacity = async (organizationId: string) => {
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
        inArray(mailbox.provider, ["gmail", "outlook"])
      )
    );
  return { limit: GMAIL_MAILBOX_LIMITS[plan], used: usage?.count ?? 0 };
};

export const withExternalMailboxCapacity = async <Result>(
  input: {
    beforeAdmission?: (database: DatabaseTransaction) => Promise<void>;
    organizationId: string;
    userId: string;
    mailboxId: string | null;
    provider: "gmail" | "outlook";
  },
  run: (database: DatabaseTransaction) => Promise<Result>
) => {
  const { limit } = await getExternalMailboxCapacity(input.organizationId);
  return await db.transaction(async (database) => {
    await input.beforeAdmission?.(database);
    await database.execute(
      sql`select set_config('quieter.action_protocol', 'personal-actions-v1', true)`
    );
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
        existing.provider !== input.provider)
    ) {
      throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
    }
    if (existing?.organizationId !== input.organizationId) {
      const [usage] = await database
        .select({ count: count() })
        .from(mailbox)
        .where(
          and(
            eq(mailbox.organizationId, input.organizationId),
            inArray(mailbox.provider, ["gmail", "outlook"])
          )
        );
      if ((usage?.count ?? 0) >= limit) {
        throw new ORPCError("FORBIDDEN", {
          message: `This team has reached its limit of ${limit} connected mail accounts. Disconnect an account or upgrade your plan.`,
        });
      }
    }
    return await run(database);
  });
};
