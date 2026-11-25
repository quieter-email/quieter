import { DurableObject } from "cloudflare:workers";

import { gmailMailboxScheduler } from "./gmail-mailbox-scheduler";

type PendingWake = { mailboxId: string; notBefore: number };

export class GmailFreshExecutor extends DurableObject<Env> {
  async wake({ mailboxId, notBefore }: PendingWake & { count?: number }) {
    await gmailMailboxScheduler(this.env, mailboxId).wake(mailboxId, {
      fresh: notBefore,
    });
  }

  async alarm() {
    const { storage } = this.ctx;
    const previous = await storage.get<{ active: PendingWake | null }>(
      "schedule"
    );
    if (previous === undefined) {
      return;
    }
    // Keep the legacy alarm live until every outstanding wake is handed off.
    await storage.setAlarm(Date.now() + 60_000);
    if (previous.active !== null) {
      await this.wake(previous.active);
    }
    for (const wake of storage.sql
      .exec<PendingWake>(
        "SELECT mailboxId, notBefore FROM pending_mailboxes ORDER BY serviceOrder LIMIT 32"
      )
      .toArray()) {
      await this.wake(wake);
      storage.sql.exec(
        "DELETE FROM pending_mailboxes WHERE mailboxId = ?",
        wake.mailboxId
      );
    }
    const [remaining] = storage.sql.exec(
      "SELECT 1 FROM pending_mailboxes LIMIT 1"
    );
    if (remaining === undefined) {
      await storage.delete("schedule");
      await storage.deleteAlarm();
    } else {
      await storage.put("schedule", { active: null });
      await storage.setAlarm(Date.now() + 1000);
    }
  }
}
