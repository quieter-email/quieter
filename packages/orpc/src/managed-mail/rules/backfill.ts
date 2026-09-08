import { randomUUID } from "node:crypto";

import { db } from "@quieter/database/client";
import {
  managedMailMessage,
  managedMailRule,
  managedMailRuleBackfill,
} from "@quieter/database/schema";
import { reportError } from "@quieter/observability";
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import { applyManagedRulesToMessage } from "./evaluator";
import { managedRuleSnapshotSchema, snapshotManagedRule } from "./snapshot";

export const processManagedRuleBackfills = async () => {
  const deadline = Date.now() + 25_000;
  const jobs = await db
    .select({ id: managedMailRuleBackfill.id })
    .from(managedMailRuleBackfill)
    .where(
      and(
        inArray(managedMailRuleBackfill.status, ["pending", "running"]),
        or(
          isNull(managedMailRuleBackfill.leasedUntil),
          lt(managedMailRuleBackfill.leasedUntil, new Date())
        )
      )
    )
    .orderBy(asc(managedMailRuleBackfill.updatedAt))
    .limit(10);
  for (const job of jobs) {
    if (Date.now() >= deadline) {
      break;
    }
    const leaseId = randomUUID();
    const [claimed] = await db
      .update(managedMailRuleBackfill)
      .set({
        leaseId,
        leasedUntil: new Date(Date.now() + 300_000),
        status: "running",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(managedMailRuleBackfill.id, job.id),
          inArray(managedMailRuleBackfill.status, ["pending", "running"]),
          or(
            isNull(managedMailRuleBackfill.leasedUntil),
            lt(managedMailRuleBackfill.leasedUntil, new Date())
          )
        )
      )
      .returning();
    if (claimed === undefined) {
      continue;
    }
    const owned = and(
      eq(managedMailRuleBackfill.id, job.id),
      eq(managedMailRuleBackfill.leaseId, leaseId),
      eq(managedMailRuleBackfill.status, "running")
    );
    let current = claimed;
    try {
      let definition = managedRuleSnapshotSchema.safeParse(
        current.definition
      ).data;
      if (definition === undefined) {
        const [rule] = await db
          .select()
          .from(managedMailRule)
          .where(
            and(
              eq(managedMailRule.id, current.ruleId),
              eq(managedMailRule.mailboxId, current.mailboxId)
            )
          );
        if (rule === undefined) {
          throw new Error("Rule not found.");
        }
        definition = snapshotManagedRule(rule);
        await db
          .update(managedMailRuleBackfill)
          .set({ definition })
          .where(owned);
      }
      while (Date.now() < deadline) {
        const [renewed] = await db
          .update(managedMailRuleBackfill)
          .set({
            leasedUntil: new Date(Date.now() + 300_000),
            startedAt: current.startedAt ?? new Date(),
            updatedAt: new Date(),
          })
          .where(owned)
          .returning();
        if (renewed === undefined) {
          break;
        }
        current = renewed;
        const [message] = await db
          .select({ id: managedMailMessage.id })
          .from(managedMailMessage)
          .where(
            and(
              eq(managedMailMessage.mailboxId, current.mailboxId),
              eq(managedMailMessage.direction, "inbound"),
              current.cursor
                ? sql`${managedMailMessage.id} > ${current.cursor}`
                : undefined,
              lte(managedMailMessage.createdAt, current.createdAt)
            )
          )
          .orderBy(asc(managedMailMessage.id))
          .limit(1);
        if (message === undefined) {
          await db
            .update(managedMailRuleBackfill)
            .set({
              completedAt: new Date(),
              status: "completed",
              updatedAt: new Date(),
            })
            .where(owned);
          break;
        }
        const result = await applyManagedRulesToMessage({
          mailboxId: current.mailboxId,
          messageId: message.id,
          ruleId: current.ruleId,
          snapshot: definition,
        });
        if (result.error !== null) {
          throw new Error(result.error);
        }
        const [updated] = await db
          .update(managedMailRuleBackfill)
          .set({
            cursor: message.id,
            lastError: null,
            matchedCount: current.matchedCount + Number(result.matched),
            processedCount: current.processedCount + 1,
            updatedAt: new Date(),
            updatedCount: current.updatedCount + Number(result.matched),
          })
          .where(owned)
          .returning();
        if (updated === undefined) {
          break;
        }
        current = updated;
      }
    } catch (error) {
      reportError(error, { operation: "managed-mail:rule-backfill" });
      await db
        .update(managedMailRuleBackfill)
        .set({
          errorCount: sql`${managedMailRuleBackfill.errorCount} + 1`,
          lastError: (error instanceof Error
            ? error.message
            : "Rule execution failed."
          ).slice(0, 2000),
          status: "failed",
          updatedAt: new Date(),
        })
        .where(owned);
    } finally {
      await db
        .update(managedMailRuleBackfill)
        .set({ leaseId: null, leasedUntil: null })
        .where(
          and(
            eq(managedMailRuleBackfill.id, job.id),
            eq(managedMailRuleBackfill.leaseId, leaseId)
          )
        );
    }
  }
};
