import { withRequestDatabaseClient } from "@quieter/database/client";
import { cleanupRateLimitBuckets } from "@quieter/orpc/abuse-protection";
import { purgeExpiredAiGeneratedMailBodies } from "@quieter/orpc/ai-mail-authorship";
import { processPendingAiMemoryEvents } from "@quieter/orpc/ai-memory";
import { processPendingMailMemoryBootstrap } from "@quieter/orpc/ai-memory-capture";
import { runDueDailyBriefs } from "@quieter/orpc/daily-brief";
import { cleanupGmailComposeOperations } from "@quieter/orpc/gmail-compose-retention";
import { recoverMailSends } from "@quieter/orpc/mail-send";
import { retryPendingManagedVerificationCodes } from "@quieter/orpc/managed-mail/ingestion";
import { processManagedRuleBackfills } from "@quieter/orpc/managed-mail/rule-backfills";
import { cleanupMailObjects } from "@quieter/orpc/managed-mail/storage";
import { cleanupMailboxVerificationCodes } from "@quieter/orpc/verification-codes";

import { reportWorkerError, withSentryReporting } from "./worker-runtime";

export default withSentryReporting({
  async scheduled() {
    try {
      await withRequestDatabaseClient(async () => {
        const results = await Promise.allSettled([
          recoverMailSends(),
          processPendingAiMemoryEvents(),
          processPendingMailMemoryBootstrap(),
          purgeExpiredAiGeneratedMailBodies(),
          cleanupGmailComposeOperations(),
          cleanupMailObjects(),
          cleanupRateLimitBuckets(),
          processManagedRuleBackfills(),
          retryPendingManagedVerificationCodes(),
          cleanupMailboxVerificationCodes(),
          runDueDailyBriefs({ limit: 2 }),
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
