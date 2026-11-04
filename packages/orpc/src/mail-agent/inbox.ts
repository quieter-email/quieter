import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { actionSpecificationSchema } from "@quieter/ai/action-specification";
import { db } from "@quieter/database/client";
import {
  mailbox,
  mailboxAgentRevision,
  mailboxAgentRun,
  mailboxPersonalAgentSetting,
} from "@quieter/database/schema";
import { and, eq, sql } from "drizzle-orm";

import { publishMailUpdate } from "../mail-updates";
import { assertPersonalAgentSettingAccess } from "./authority";
import type { MailAgentIncomingMessage } from "./contracts";

export const enqueueMailAgentMessage = async (
  input: MailAgentIncomingMessage
): Promise<void> => {
  if (!Number.isFinite(input.receivedAt.getTime())) {
    return;
  }
  const settings = await db
    .select({ userId: mailboxPersonalAgentSetting.userId })
    .from(mailboxPersonalAgentSetting)
    .where(
      and(
        eq(mailboxPersonalAgentSetting.mailboxId, input.mailboxId),
        eq(mailboxPersonalAgentSetting.enabled, true)
      )
    );
  for (const { userId } of settings) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Limit database concurrency while durably enqueueing each owner's independent action.
    const queued = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('quieter.action_protocol', 'personal-actions-v1', true)`
      );
      await tx
        .select({ id: mailbox.id })
        .from(mailbox)
        .where(eq(mailbox.id, input.mailboxId))
        .for("update");
      const [active] = await tx
        .select({
          revision: mailboxAgentRevision,
          setting: mailboxPersonalAgentSetting,
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
            eq(
              mailboxAgentRevision.createdByUserId,
              mailboxPersonalAgentSetting.userId
            )
          )
        )
        .where(
          and(
            eq(mailboxPersonalAgentSetting.mailboxId, input.mailboxId),
            eq(mailboxPersonalAgentSetting.userId, userId),
            eq(mailboxPersonalAgentSetting.enabled, true)
          )
        )
        .limit(1)
        .for("update");
      if (
        !active?.setting.activatedAt ||
        input.receivedAt <= active.setting.activatedAt
      ) {
        return false;
      }
      const parsed = actionSpecificationSchema.safeParse(
        active.revision.specification
      );
      if (
        !parsed.success ||
        parsed.data.mailboxId !== input.mailboxId ||
        parsed.data.trigger.kind !== "mail_received"
      ) {
        return false;
      }
      try {
        await assertPersonalAgentSettingAccess(active.setting, tx);
      } catch (error) {
        if (
          error instanceof ORPCError &&
          (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")
        ) {
          return false;
        }
        throw error;
      }
      const [previous] = await tx
        .select({ id: mailboxAgentRun.id })
        .from(mailboxAgentRun)
        .where(
          and(
            eq(mailboxAgentRun.mailboxId, input.mailboxId),
            eq(mailboxAgentRun.actorUserId, userId),
            eq(mailboxAgentRun.messageId, input.messageId)
          )
        )
        .limit(1);
      if (previous !== undefined) {
        return false;
      }
      const now = new Date();
      const [run] = await tx
        .insert(mailboxAgentRun)
        .values({
          actorUserId: userId,
          createdAt: now,
          id: randomUUID(),
          invocationKey: `received:${userId}:${input.messageId}`,
          mailboxId: input.mailboxId,
          messageId: input.messageId,
          privateResult: true,
          revisionId: active.revision.id,
          settingVersion: active.setting.activationVersion,
          status: "queued",
          threadId: input.threadId,
          triggerKind: "mail_received",
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: mailboxAgentRun.id });
      return run !== undefined;
    });
    if (queued) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Deliver a private update after this owner's durable enqueue commits.
      await publishMailUpdate(
        {
          mailboxId: input.mailboxId,
          threadIds: [input.threadId],
          type: "details.changed",
        },
        { recipientUserIds: [userId] }
      );
    }
  }
};
