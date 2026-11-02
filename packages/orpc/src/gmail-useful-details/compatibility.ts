import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  gmailUsefulDetail,
  gmailUsefulDetailFeedback,
  gmailUsefulDetailSettings,
  mailboxAutomationSettings,
} from "@quieter/database/schema";
import type { GmailUsefulDetailFeedbackSignal } from "@quieter/database/schema";
import { reportError } from "@quieter/observability";
import { and, eq } from "drizzle-orm";

import { learnAiMemoryFromFeedback } from "../ai-memory";
import { assertOwnedGmailMailbox } from "../mailbox/access";
import {
  assertAccessibleMailbox,
  getAuthorizedManagedMailbox,
} from "../mailbox/service";

export const listGmailUsefulDetails = async (input: {
  mailboxId: string;
  userId: string;
}) => {
  await assertOwnedGmailMailbox(input);
  return { enabled: false, items: [], nextRelevantAt: null };
};

export const listGmailThreadUsefulDetails = async (input: {
  gmailThreadId: string;
  mailboxId: string;
  userId: string;
}) => {
  await assertOwnedGmailMailbox(input);
  return [];
};

export const setGmailUsefulDetails = async (input: {
  enabled: boolean;
  mailboxId: string;
  userId: string;
}) => {
  const selectedMailbox = await assertAccessibleMailbox(input);
  if (selectedMailbox.provider === "managed") {
    await getAuthorizedManagedMailbox({
      mailboxId: input.mailboxId,
      requiredRoles: ["manager"],
      userId: input.userId,
    });
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .insert(mailboxAutomationSettings)
      .values({
        createdAt: now,
        mailboxId: input.mailboxId,
        updatedAt: now,
        usefulDetailsEnabled: false,
      })
      .onConflictDoUpdate({
        set: { updatedAt: now, usefulDetailsEnabled: false },
        target: mailboxAutomationSettings.mailboxId,
      });

    if (selectedMailbox.provider === "gmail") {
      await tx
        .insert(gmailUsefulDetailSettings)
        .values({
          createdAt: now,
          enabled: false,
          mailboxId: input.mailboxId,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          set: { enabled: false, updatedAt: now },
          target: gmailUsefulDetailSettings.mailboxId,
        });
    }
  });

  return { enabled: false, mailboxId: input.mailboxId };
};

export const dismissGmailUsefulDetail = async (input: {
  id: string;
  mailboxId: string;
  userId: string;
}) => {
  await assertOwnedGmailMailbox(input);
  const now = new Date();
  const [dismissed] = await db
    .update(gmailUsefulDetail)
    .set({ dismissedAt: now, updatedAt: now })
    .where(
      and(
        eq(gmailUsefulDetail.id, input.id),
        eq(gmailUsefulDetail.mailboxId, input.mailboxId)
      )
    )
    .returning({
      id: gmailUsefulDetail.id,
      kind: gmailUsefulDetail.kind,
      source: gmailUsefulDetail.source,
    });
  if (dismissed === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Useful detail not found." });
  }
  try {
    await learnAiMemoryFromFeedback({
      kind: "useful_detail_feedback",
      mailboxId: input.mailboxId,
      metadata: {
        detailType: dismissed.kind,
        feedback: "dismiss",
        source: dismissed.source,
      },
      userId: input.userId,
    });
  } catch (error) {
    reportError(error, { operation: "useful-details:learn-from-dismissal" });
  }
  return { dismissed: true, id: dismissed.id };
};

export const setGmailUsefulDetailFeedback = async (input: {
  feedback: GmailUsefulDetailFeedbackSignal;
  id: string;
  mailboxId: string;
  userId: string;
}) => {
  await assertOwnedGmailMailbox(input);
  const now = new Date();
  const ratedDetail = await db.transaction(async (tx) => {
    const [detail] = await tx
      .select({
        id: gmailUsefulDetail.id,
        kind: gmailUsefulDetail.kind,
        relevanceSource: gmailUsefulDetail.relevanceSource,
        source: gmailUsefulDetail.source,
      })
      .from(gmailUsefulDetail)
      .where(
        and(
          eq(gmailUsefulDetail.id, input.id),
          eq(gmailUsefulDetail.mailboxId, input.mailboxId)
        )
      )
      .limit(1)
      .for("update");
    if (detail === undefined) {
      throw new ORPCError("NOT_FOUND", {
        message: "Useful detail not found.",
      });
    }

    await tx
      .insert(gmailUsefulDetailFeedback)
      .values({
        createdAt: now,
        detailId: detail.id,
        id: randomUUID(),
        kind: detail.kind,
        mailboxId: input.mailboxId,
        signal: input.feedback,
        source: detail.source,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        set: {
          kind: detail.kind,
          signal: input.feedback,
          source: detail.source,
          updatedAt: now,
        },
        target: [
          gmailUsefulDetailFeedback.mailboxId,
          gmailUsefulDetailFeedback.detailId,
        ],
      });

    if (input.feedback === "not_useful") {
      await tx
        .update(gmailUsefulDetail)
        .set({ dismissedAt: now, updatedAt: now })
        .where(
          and(
            eq(gmailUsefulDetail.id, detail.id),
            eq(gmailUsefulDetail.mailboxId, input.mailboxId)
          )
        );
    }
    return detail;
  });

  try {
    await learnAiMemoryFromFeedback({
      kind: "useful_detail_feedback",
      mailboxId: input.mailboxId,
      metadata: {
        detailType: ratedDetail.kind,
        feedback: input.feedback,
        relevanceSource: ratedDetail.relevanceSource,
        source: ratedDetail.source,
      },
      userId: input.userId,
    });
  } catch (error) {
    reportError(error, { operation: "useful-details:learn-from-feedback" });
  }

  return { feedback: input.feedback, id: ratedDetail.id };
};
