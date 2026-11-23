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

import { reportWorkerError, withSentryReporting } from "./worker-runtime";

export default withSentryReporting({
  async scheduled() {
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
