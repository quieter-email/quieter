import { randomUUID } from "node:crypto";

import { actionSpecificationSchema } from "@quieter/ai/action-specification";
import { db } from "@quieter/database/client";
import {
  mailboxAgentRevision,
  mailboxAgentRun,
  mailboxAgentSetting,
} from "@quieter/database/schema";
import { and, eq } from "drizzle-orm";

import { publishMailUpdate } from "../mail-updates";
import type { MailAgentIncomingMessage } from "./contracts";

export const enqueueMailAgentMessage = async (
  input: MailAgentIncomingMessage
): Promise<void> => {
  const [active] = await db
    .select({
      setting: mailboxAgentSetting,
      specification: mailboxAgentRevision.specification,
    })
    .from(mailboxAgentSetting)
    .innerJoin(
      mailboxAgentRevision,
      and(
        eq(mailboxAgentRevision.id, mailboxAgentSetting.activeRevisionId),
        eq(mailboxAgentRevision.mailboxId, mailboxAgentSetting.mailboxId)
      )
    )
    .where(
      and(
        eq(mailboxAgentSetting.mailboxId, input.mailboxId),
        eq(mailboxAgentSetting.enabled, true)
      )
    )
    .limit(1);
  if (
    !active?.setting.activatedAt ||
    !active.setting.activatedByUserId ||
    !active.setting.activeRevisionId ||
    !Number.isFinite(input.receivedAt.getTime()) ||
    input.receivedAt <= active.setting.activatedAt
  ) {
    return;
  }
  const parsed = actionSpecificationSchema.safeParse(active.specification);
  if (
    !parsed.success ||
    parsed.data.mailboxId !== input.mailboxId ||
    parsed.data.trigger.kind !== "mail_received"
  ) {
    return;
  }
  const now = new Date();
  const [queued] = await db
    .insert(mailboxAgentRun)
    .values({
      actorUserId: active.setting.activatedByUserId,
      createdAt: now,
      id: randomUUID(),
      invocationKey: `received:${input.messageId}`,
      mailboxId: input.mailboxId,
      messageId: input.messageId,
      privateResult: true,
      revisionId: active.setting.activeRevisionId,
      settingVersion: active.setting.activationVersion,
      status: "queued",
      threadId: input.threadId,
      triggerKind: "mail_received",
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [mailboxAgentRun.mailboxId, mailboxAgentRun.invocationKey],
    })
    .returning({ id: mailboxAgentRun.id });
  if (queued !== undefined) {
    await publishMailUpdate(
      {
        mailboxId: input.mailboxId,
        threadIds: [input.threadId],
        type: "details.changed",
      },
      { recipientUserIds: [active.setting.activatedByUserId] }
    );
  }
};
