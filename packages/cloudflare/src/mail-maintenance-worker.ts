import { withRequestDatabaseClient } from "@quieter/database/client";
import { cleanupRateLimitBuckets } from "@quieter/orpc/abuse-protection";
import { recoverMailSends } from "@quieter/orpc/mail-send";
import { processManagedRuleBackfills } from "@quieter/orpc/managed-mail/rule-backfills";
import { cleanupMailObjects } from "@quieter/orpc/managed-mail/storage";

import { reportWorkerError, withSentryReporting } from "./worker-runtime";

export default withSentryReporting({
  async scheduled() {
    try {
      await withRequestDatabaseClient(async () => {
        const results = await Promise.allSettled([
          recoverMailSends(),
          cleanupMailObjects(),
          cleanupRateLimitBuckets(),
          processManagedRuleBackfills(),
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
