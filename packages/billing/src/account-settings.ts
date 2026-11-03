import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  billingAccountSettings,
  organization,
  member,
  user,
} from "@quieter/database/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

export const getAccountUsageSettings = async (
  userId: string,
  client: Pick<typeof db, "select"> = db
) => {
  const [settings] = await client
    .select({
      monthlyOverageLimitMicroCents:
        billingAccountSettings.monthlyOverageLimitMicroCents,
      overageEnabled: billingAccountSettings.overageEnabled,
    })
    .from(billingAccountSettings)
    .where(eq(billingAccountSettings.userId, userId))
    .limit(1);
  return (
    settings ?? { monthlyOverageLimitMicroCents: null, overageEnabled: false }
  );
};

export const updateAccountUsageSettings = async (input: {
  monthlyOverageLimitMicroCents: number | null;
  overageEnabled: boolean;
  userId: string;
}) => {
  await db.transaction(async (transaction) => {
    await transaction
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, input.userId))
      .for("update");
    await transaction
      .insert(billingAccountSettings)
      .values({
        ...input,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        set: {
          monthlyOverageLimitMicroCents: input.monthlyOverageLimitMicroCents,
          overageEnabled: input.overageEnabled,
          updatedAt: new Date(),
        },
        target: billingAccountSettings.userId,
      });
  });
};

export const takeOverOrganizationBilling = async (input: {
  organizationId: string;
  userId: string;
}) =>
  await db.transaction(async (transaction) => {
    const [observed] = await transaction
      .select({ billingOwnerUserId: organization.billingOwnerUserId })
      .from(organization)
      .where(eq(organization.id, input.organizationId));
    const payerIds = [
      ...new Set([
        input.userId,
        ...(observed?.billingOwnerUserId ? [observed.billingOwnerUserId] : []),
      ]),
    ].toSorted();
    const payers = await transaction
      .select({ id: user.id })
      .from(user)
      .where(inArray(user.id, payerIds))
      .orderBy(asc(user.id))
      .for("update");
    if (!payers.some((payer) => payer.id === input.userId)) {
      throw new ORPCError("FORBIDDEN");
    }
    const settings = await transaction
      .select()
      .from(billingAccountSettings)
      .where(inArray(billingAccountSettings.userId, payerIds));
    const [team] = await transaction
      .select()
      .from(organization)
      .where(eq(organization.id, input.organizationId))
      .for("update");
    if (
      team === undefined ||
      team.billingOwnerUserId !== observed?.billingOwnerUserId
    ) {
      throw new ORPCError("CONFLICT", {
        message: "Billing changed. Reload and try again.",
      });
    }
    if (
      team.billingDeletionRequestedAt !== null ||
      settings.some((setting) => setting.deletionRequestedAt !== null)
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Billing cannot change while an account or team is closing.",
      });
    }
    const [membership] = await transaction
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, input.organizationId),
          eq(member.userId, input.userId),
          sql`'owner' = any(string_to_array(${member.role}, ','))`
        )
      );
    if (membership === undefined) {
      throw new ORPCError("FORBIDDEN", {
        message: "Only a team owner can take over billing.",
      });
    }
    await transaction
      .update(organization)
      .set({ billingOwnerUserId: input.userId, updatedAt: new Date() })
      .where(eq(organization.id, input.organizationId));
    return { transferred: true };
  });
