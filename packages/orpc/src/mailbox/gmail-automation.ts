import { db } from "@quieter/database/client";
import { mailbox } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { and, eq } from "drizzle-orm";

import { processPendingAiMemoryEvents } from "../ai-memory";
import { processPendingMailMemoryBootstrap } from "../ai-memory-capture";
import { drainMailAgentRuns } from "../mail-agent/runtime";
import { processPendingMailImportance } from "../mail-importance";
import { processReminderJobs } from "../reminders/runtime";
import { processPendingSemanticIndexes } from "../semantic-index";
import { getGmailMailboxAutomationWake } from "./automation-readiness";
import type { GmailMailboxAutomationKind } from "./automation-readiness";
import type { MailboxAutomationScope } from "./automation-scope";

export type { GmailMailboxAutomationKind } from "./automation-readiness";
export {
  getGmailMailboxAutomationWake,
  listDueGmailMailboxAutomation,
} from "./automation-readiness";

export const processGmailMailboxAutomation = async (input: {
  kind: GmailMailboxAutomationKind;
  mailboxId: string;
  limit?: number;
  allowLocal?: boolean;
}): Promise<{ nextWakeAt: number | null }> => {
  const scope = {
    allowLocal: input.allowLocal,
    limit: Math.min(20, Math.max(1, input.limit ?? 4)),
    mailboxId: input.mailboxId,
    provider: "gmail",
  } satisfies MailboxAutomationScope & { allowLocal?: boolean; limit: number };
  switch (input.kind) {
    case "actions": {
      await drainMailAgentRuns({ ...scope, concurrency: 1 });
      break;
    }
    case "importance": {
      await processPendingMailImportance({ ...scope, backfill: false });
      break;
    }
    case "memory": {
      if (
        serverEnv.QUIETER_DEPLOYMENT_ENV === "local" &&
        input.allowLocal !== true
      ) {
        return { nextWakeAt: null };
      }
      await processPendingAiMemoryEvents(scope);
      await processPendingMailMemoryBootstrap({ ...scope, seedMissing: false });
      const local = serverEnv.QUIETER_DEPLOYMENT_ENV === "local";
      const [owner] = local
        ? await db
            .select({ userId: mailbox.ownerUserId })
            .from(mailbox)
            .where(
              and(
                eq(mailbox.id, input.mailboxId),
                eq(mailbox.provider, "gmail"),
                eq(mailbox.status, "connected")
              )
            )
            .limit(1)
        : [];
      if (!local || owner?.userId) {
        await processPendingSemanticIndexes({
          allowLocal: local,
          limit: 1,
          mailboxId: input.mailboxId,
          provider: "gmail",
          userId: owner?.userId ?? undefined,
        });
      }
      break;
    }
    case "reminders": {
      await processReminderJobs(scope);
      break;
    }
    default: {
      input.kind satisfies never;
      throw new Error("Unknown Gmail mailbox automation kind.");
    }
  }
  return await getGmailMailboxAutomationWake(input);
};
