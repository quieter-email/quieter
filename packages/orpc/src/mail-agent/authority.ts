import { ORPCError } from "@orpc/server";
import { actionSpecificationSchema } from "@quieter/ai/action-specification";
import { db } from "@quieter/database/client";
import {
  mailbox,
  mailboxAgentRevision,
  mailboxAgentRun,
  mailboxPersonalAgentSetting,
} from "@quieter/database/schema";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";

import { assertAgentMailboxAccess } from "./access";

export const pausePersonalAgentConnections = async (
  input: { connectionIds: string[]; userId: string },
  database: Pick<typeof db, "select" | "update">
) => {
  const settings = await database
    .select({ mailboxId: mailboxPersonalAgentSetting.mailboxId })
    .from(mailboxPersonalAgentSetting)
    .where(eq(mailboxPersonalAgentSetting.userId, input.userId));
  if (settings.length === 0 || input.connectionIds.length === 0) {
    return;
  }
  await database
    .select({ id: mailbox.id })
    .from(mailbox)
    .where(
      inArray(
        mailbox.id,
        settings.map((setting) => setting.mailboxId)
      )
    )
    .orderBy(asc(mailbox.id))
    .for("update");
  const active = await database
    .select({
      setting: mailboxPersonalAgentSetting,
      specification: mailboxAgentRevision.specification,
    })
    .from(mailboxPersonalAgentSetting)
    .innerJoin(
      mailboxAgentRevision,
      and(
        eq(
          mailboxAgentRevision.id,
          mailboxPersonalAgentSetting.activeRevisionId
        ),
        eq(
          mailboxAgentRevision.mailboxId,
          mailboxPersonalAgentSetting.mailboxId
        ),
        eq(mailboxAgentRevision.createdByUserId, input.userId)
      )
    )
    .where(
      and(
        eq(mailboxPersonalAgentSetting.userId, input.userId),
        eq(mailboxPersonalAgentSetting.enabled, true)
      )
    )
    .for("update");
  const mailboxIds = active
    .filter((row) => {
      const parsed = actionSpecificationSchema.safeParse(row.specification);
      return (
        !parsed.success ||
        parsed.data.connectors.some((connector) =>
          input.connectionIds.includes(connector.connectionId)
        )
      );
    })
    .map((row) => row.setting.mailboxId);
  if (mailboxIds.length > 0) {
    await database
      .update(mailboxPersonalAgentSetting)
      .set({
        activationVersion: sql`${mailboxPersonalAgentSetting.version} + 1`,
        enabled: false,
        updatedAt: new Date(),
        version: sql`${mailboxPersonalAgentSetting.version} + 1`,
      })
      .where(
        and(
          eq(mailboxPersonalAgentSetting.userId, input.userId),
          inArray(mailboxPersonalAgentSetting.mailboxId, mailboxIds)
        )
      );
  }
};

export const assertPersonalAgentSettingAccess = async (
  setting: typeof mailboxPersonalAgentSetting.$inferSelect,
  database: Pick<typeof db, "select"> = db,
  saveDraft = false
) => {
  const access = await assertAgentMailboxAccess(
    { mailboxId: setting.mailboxId, saveDraft, userId: setting.userId },
    database
  );
  if (access.memberId !== setting.memberId) {
    throw new ORPCError("FORBIDDEN", {
      message: "Your inbox access changed. Review your action again.",
    });
  }
  return access;
};

export const assertMailAgentRunAuthority = async (
  run: typeof mailboxAgentRun.$inferSelect & { leaseToken: string },
  database: Pick<typeof db, "select"> = db,
  lock = false
) => {
  if (lock) {
    await database
      .select({ id: mailbox.id })
      .from(mailbox)
      .where(eq(mailbox.id, run.mailboxId))
      .for("update");
  }
  const query = database
    .select()
    .from(mailboxPersonalAgentSetting)
    .where(
      and(
        eq(mailboxPersonalAgentSetting.mailboxId, run.mailboxId),
        eq(mailboxPersonalAgentSetting.userId, run.actorUserId),
        eq(mailboxPersonalAgentSetting.activeRevisionId, run.revisionId),
        eq(mailboxPersonalAgentSetting.enabled, true),
        eq(mailboxPersonalAgentSetting.activationVersion, run.settingVersion)
      )
    )
    .limit(1);
  const [setting] = await (lock ? query.for("update") : query);
  if (setting === undefined || !run.privateResult) {
    throw new ORPCError("FORBIDDEN", {
      message: "Your action was paused or replaced before it finished.",
    });
  }
  const [revision] = await database
    .select({ id: mailboxAgentRevision.id })
    .from(mailboxAgentRevision)
    .where(
      and(
        eq(mailboxAgentRevision.id, run.revisionId),
        eq(mailboxAgentRevision.mailboxId, run.mailboxId),
        eq(mailboxAgentRevision.createdByUserId, run.actorUserId)
      )
    )
    .limit(1);
  if (revision === undefined) {
    throw new ORPCError("FORBIDDEN", {
      message: "Review your own action before running it.",
    });
  }
  const leaseQuery = database
    .select({ id: mailboxAgentRun.id })
    .from(mailboxAgentRun)
    .where(
      and(
        eq(mailboxAgentRun.id, run.id),
        eq(mailboxAgentRun.mailboxId, run.mailboxId),
        eq(mailboxAgentRun.actorUserId, run.actorUserId),
        eq(mailboxAgentRun.leaseToken, run.leaseToken),
        eq(mailboxAgentRun.status, "running"),
        gt(mailboxAgentRun.leaseExpiresAt, new Date())
      )
    )
    .limit(1);
  const [lease] = await (lock ? leaseQuery.for("update") : leaseQuery);
  if (lease === undefined) {
    throw new ORPCError("CONFLICT", {
      message: "This action no longer owns its run.",
    });
  }
  return await assertPersonalAgentSettingAccess(setting, database);
};
