import { withRequestDatabaseClient } from "@quieter/database/client";
import { serverEnv } from "@quieter/env/server";
import { cleanupRateLimitBuckets } from "@quieter/orpc/abuse-protection";
import { purgeExpiredAiGeneratedMailBodies } from "@quieter/orpc/ai-mail-authorship";
import { processPendingAiMemoryEvents } from "@quieter/orpc/ai-memory";
import {
  processPendingMailMemoryBootstrap,
  seedMissingMailMemoryBootstrap,
} from "@quieter/orpc/ai-memory-capture";
import { backfillGmailCapturedBodies } from "@quieter/orpc/gmail-body-backfill";
import { cleanupGmailComposeOperations } from "@quieter/orpc/gmail-compose-retention";
import {
  drainMailAgentRuns,
  reportPendingMailAgentUsage,
} from "@quieter/orpc/mail-agent";
import {
  backfillMissingMailImportanceWork,
  processPendingMailImportance,
  reportPendingMailImportanceUsage,
} from "@quieter/orpc/mail-importance";
import { recoverMailSends } from "@quieter/orpc/mail-send";
import { retryPendingManagedVerificationCodes } from "@quieter/orpc/managed-mail/ingestion";
import { processManagedRuleBackfills } from "@quieter/orpc/managed-mail/rule-backfills";
import { cleanupMailObjects } from "@quieter/orpc/managed-mail/storage";
import { reconcileReminderSchedules } from "@quieter/orpc/reminders/clock";
import {
  processReminderJobs,
  reportPendingReminderUsage,
  reportPendingReminderSuggestionUsage,
} from "@quieter/orpc/reminders/runtime";
import { reconcileScheduledSends } from "@quieter/orpc/scheduled-send/repair";
import { processPendingSemanticIndexes } from "@quieter/orpc/semantic-index";
import { cleanupMailboxVerificationCodes } from "@quieter/orpc/verification-codes";
import { DurableObject } from "cloudflare:workers";

import { readBoundedJson } from "./bounded-json";
import {
  mailMaintenanceBootstrap,
  mailMaintenanceDispatchSchema,
  runMailMaintenance,
} from "./mail-maintenance-tasks";
import type { MailMaintenanceDispatch } from "./mail-maintenance-tasks";
import { requestErrorResponse } from "./request-error";
import { reportWorkerError, withSentryReporting } from "./worker-runtime";

type Pending = {
  cursor: string | null;
  dueAt: number | null;
  retries: number;
  scopeKey: string;
  task: MailMaintenanceDispatch["task"];
};

export class MailMaintenanceScheduler extends DurableObject<Env> {
  async wake(dispatch: MailMaintenanceDispatch) {
    await this.ctx.storage.transaction(async (storage) => {
      const pending = await storage.get<Pending>("pending");
      const dueAt = Math.min(
        dispatch.dueAt ?? Date.now(),
        pending?.dueAt ?? Infinity
      );
      if (pending?.dueAt === dueAt) {
        return;
      }
      await storage.put("pending", {
        cursor: pending?.cursor ?? null,
        dueAt,
        retries: pending?.retries ?? 0,
        scopeKey: dispatch.scopeKey,
        task: dispatch.task,
      } satisfies Pending);
      await storage.setAlarm(Math.max(Date.now() + 1, dueAt));
    });
  }

  async alarm() {
    const pending = await this.ctx.storage.transaction(async (storage) => {
      const current = await storage.get<Pending>("pending");
      if (current === undefined) {
        return null;
      }
      if (current.dueAt !== null && current.dueAt > Date.now()) {
        await storage.setAlarm(current.dueAt);
        return null;
      }
      await storage.put("pending", { ...current, dueAt: null });
      // Recover an interrupted drain even after the platform exhausts its retries.
      await storage.setAlarm(Date.now() + 120_000);
      return current;
    });
    if (pending === null) {
      return;
    }

    let nextWakeAt: number | null;
    let { cursor } = pending;
    let retries = 0;
    try {
      const result = await withRequestDatabaseClient(
        async () =>
          await runMailMaintenance(
            { scopeKey: pending.scopeKey, task: pending.task },
            pending.cursor
          )
      );
      ({ nextWakeAt } = result);
      cursor = result.cursor ?? (result.nextWakeAt === null ? null : cursor);
    } catch (error) {
      reportWorkerError(error, {
        category: "mail_maintenance_error",
        route: pending.task,
      });
      retries = pending.retries + 1;
      nextWakeAt =
        Date.now() + Math.min(300_000, 5000 * 2 ** Math.min(retries, 6));
    }

    await this.ctx.storage.transaction(async (storage) => {
      const current = await storage.get<Pending>("pending");
      const dueAt = Math.min(
        current?.dueAt ?? Infinity,
        nextWakeAt ?? Infinity
      );
      if (!Number.isFinite(dueAt)) {
        await storage.delete("pending");
        await storage.deleteAlarm();
        return;
      }
      await storage.put("pending", { ...pending, cursor, dueAt, retries });
      await storage.setAlarm(Math.max(Date.now() + 1, dueAt));
    });
  }
}

export default withSentryReporting({
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (request.method !== "POST") {
      return new Response(null, { status: 405 });
    }
    let registrations: MailMaintenanceDispatch[];
    if (pathname === "/internal/maintenance/bootstrap") {
      registrations = mailMaintenanceBootstrap;
    } else if (pathname === "/internal/maintenance/dispatch") {
      const value = await readBoundedJson(request, 4096).catch(
        (error: unknown) => requestErrorResponse(error, pathname)
      );
      if (value instanceof Response) {
        return value;
      }
      const parsed = mailMaintenanceDispatchSchema.safeParse(value);
      if (!parsed.success) {
        return new Response(null, { status: 400 });
      }
      registrations = [parsed.data];
    } else {
      return new Response(null, { status: 404 });
    }
    await Promise.all(
      registrations.map(async (registration) => {
        const identity = JSON.stringify([
          registration.task,
          registration.scopeKey,
        ]);
        await env.MailMaintenanceScheduler.getByName(identity).wake(
          registration
        );
      })
    );
    return new Response(null, { status: 204 });
  },
  async scheduled() {
    if (serverEnv.QUIETER_MAIL_MAINTENANCE_EVENTS_ENABLED === true) {
      return;
    }
    try {
      await withRequestDatabaseClient(async () => {
        const mailboxLanes = serverEnv.QUIETER_GMAIL_MAILBOX_LANES === true;
        const globalScope = mailboxLanes
          ? ({ provider: "managed" } as const)
          : {};
        const results = await Promise.allSettled([
          recoverMailSends(),
          processPendingAiMemoryEvents(globalScope),
          mailboxLanes
            ? processPendingAiMemoryEvents({ unscopedOnly: true })
            : undefined,
          processPendingSemanticIndexes(globalScope),
          processPendingMailMemoryBootstrap(globalScope),
          mailboxLanes
            ? seedMissingMailMemoryBootstrap({ provider: "gmail" })
            : undefined,
          purgeExpiredAiGeneratedMailBodies(),
          cleanupGmailComposeOperations(),
          backfillGmailCapturedBodies(),
          cleanupMailObjects(),
          cleanupRateLimitBuckets(),
          processManagedRuleBackfills(),
          retryPendingManagedVerificationCodes(),
          cleanupMailboxVerificationCodes(),
          drainMailAgentRuns({ concurrency: 4, limit: 8, ...globalScope }),
          mailboxLanes
            ? reportPendingMailAgentUsage({ provider: "gmail" })
            : undefined,
          processPendingMailImportance({ limit: 20, ...globalScope }),
          mailboxLanes
            ? backfillMissingMailImportanceWork({ provider: "gmail" })
            : undefined,
          mailboxLanes
            ? reportPendingMailImportanceUsage(undefined, "gmail")
            : undefined,
          reconcileReminderSchedules({ limit: 20 }),
          processReminderJobs({ limit: 4, ...globalScope }),
          mailboxLanes
            ? reportPendingReminderUsage({ provider: "gmail" })
            : undefined,
          mailboxLanes
            ? reportPendingReminderSuggestionUsage({ provider: "gmail" })
            : undefined,
          reconcileScheduledSends({ limit: 20 }),
        ]);
        const failed = results.find((result) => result.status === "rejected");
        if (failed !== undefined) {
          throw failed.reason;
        }
      });
    } catch (error) {
      reportWorkerError(error, {
        category: "mail_maintenance_error",
        route: "scheduled",
      });
      throw error;
    }
  },
} satisfies ExportedHandler<Env>);
