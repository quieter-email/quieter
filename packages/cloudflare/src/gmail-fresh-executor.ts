import { instrumentDurableObjectWithSentry } from "@sentry/cloudflare";
import { DurableObject } from "cloudflare:workers";

import { processGmailJob } from "./gmail-processing-job";
import type { GmailFreshWake } from "./gmail-processing-job";
import { sentryOptions } from "./worker-runtime";

type PendingMailbox = {
  mailboxId: string;
  generation: number;
  notBefore: number;
  serviceOrder: number;
};

type FreshSchedule = {
  sequence: number;
  active: (PendingMailbox & { recoverAt: number }) | null;
};

const saveSchedule = async (
  storage: DurableObjectStorage,
  schedule: FreshSchedule
) => {
  await storage.put("schedule", schedule);
  const [pending] = storage.sql.exec<{ notBefore: number }>(
    "SELECT notBefore FROM pending_mailboxes ORDER BY notBefore LIMIT 1"
  );
  const nextAlarm = schedule.active?.recoverAt ?? pending?.notBefore;
  if (nextAlarm === undefined) {
    await storage.deleteAlarm();
  } else {
    await storage.setAlarm(Math.max(Date.now() + 1, nextAlarm));
  }
};

class GmailFreshExecutorOwner extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS pending_mailboxes (
        mailboxId TEXT PRIMARY KEY,
        generation INTEGER NOT NULL,
        notBefore INTEGER NOT NULL,
        serviceOrder INTEGER NOT NULL
      )`
    );
    ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS pending_deadline ON pending_mailboxes(notBefore)"
    );
    ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS pending_service_order ON pending_mailboxes(serviceOrder)"
    );
  }

  async wake(wake: GmailFreshWake) {
    await this.ctx.storage.transaction(async () => {
      const { storage } = this.ctx;
      const schedule = (await storage.get<FreshSchedule>("schedule")) ?? {
        active: null,
        sequence: 0,
      };
      schedule.sequence += 1;
      storage.sql.exec(
        `INSERT INTO pending_mailboxes (mailboxId, generation, notBefore, serviceOrder)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (mailboxId) DO UPDATE SET
           generation = excluded.generation,
           notBefore = MIN(pending_mailboxes.notBefore, excluded.notBefore)`,
        wake.mailboxId,
        schedule.sequence,
        wake.notBefore,
        schedule.sequence
      );
      await saveSchedule(storage, schedule);
    });
  }

  async alarm() {
    try {
      const selected = await this.ctx.storage.transaction(async () => {
        const { storage } = this.ctx;
        const schedule = (await storage.get<FreshSchedule>("schedule")) ?? {
          active: null,
          sequence: 0,
        };
        const now = Date.now();
        if (schedule.active !== null) {
          if (schedule.active.recoverAt > now) {
            await saveSchedule(storage, schedule);
            return null;
          }
          storage.sql.exec(
            `INSERT INTO pending_mailboxes (mailboxId, generation, notBefore, serviceOrder)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (mailboxId) DO UPDATE SET
               notBefore = MIN(pending_mailboxes.notBefore, excluded.notBefore)`,
            schedule.active.mailboxId,
            schedule.active.generation,
            schedule.active.notBefore,
            schedule.active.serviceOrder
          );
          schedule.active = null;
        }
        const [due] = storage.sql.exec<PendingMailbox>(
          "SELECT * FROM pending_mailboxes WHERE notBefore <= ? ORDER BY serviceOrder LIMIT 1",
          now
        );
        if (due === undefined) {
          await saveSchedule(storage, schedule);
          return null;
        }
        storage.sql.exec(
          "DELETE FROM pending_mailboxes WHERE mailboxId = ? AND generation = ?",
          due.mailboxId,
          due.generation
        );
        // The alarm's 15-minute lifetime ends before this recovery and the canonical 16-minute claim lease.
        const active = { ...due, recoverAt: now + 16 * 60_000 };
        schedule.active = active;
        await saveSchedule(storage, schedule);
        return active;
      });
      if (selected === null) {
        return;
      }
      const startedAt = performance.now();
      const dueLatenessMs = Math.max(0, Date.now() - selected.notBefore);
      const decision = await processGmailJob(
        {
          kind: "work",
          mailboxId: selected.mailboxId,
          priority: "fresh",
        },
        this.env,
        {
          onFreshWakeAccepted: async (wake) => {
            await this.wake(wake);
          },
        }
      );
      await this.ctx.storage.transaction(async () => {
        const { storage } = this.ctx;
        const schedule = await storage.get<FreshSchedule>("schedule");
        if (schedule?.active?.generation !== selected.generation) {
          return;
        }
        schedule.active = null;
        if (decision.action === "retry") {
          storage.sql.exec(
            `INSERT INTO pending_mailboxes (mailboxId, generation, notBefore, serviceOrder)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (mailboxId) DO UPDATE SET
               notBefore = MIN(pending_mailboxes.notBefore, excluded.notBefore)`,
            selected.mailboxId,
            selected.generation,
            Date.now() + decision.delaySeconds * 1000,
            selected.serviceOrder
          );
        }
        await saveSchedule(storage, schedule);
      });
      // oxlint-disable-next-line no-console -- Alarm diagnostics contain only finite outcomes and numeric durations.
      console.info({
        dueLatenessMs,
        event: "gmail_fresh_alarm_complete",
        outcome: decision.action,
        totalMs: performance.now() - startedAt,
      });
    } catch (error) {
      await this.ctx.storage.transaction(async () => {
        const { storage } = this.ctx;
        const schedule = await storage.get<FreshSchedule>("schedule");
        if (schedule !== undefined) {
          if (schedule.active === null) {
            storage.sql.exec(
              "UPDATE pending_mailboxes SET notBefore = MAX(notBefore, ?)",
              Date.now() + 60_000
            );
          }
          await saveSchedule(storage, schedule);
        }
      });
      throw error;
    }
  }
}

// oxlint-disable-next-line no-redeclare -- Wrangler needs the RPC type beside the Sentry-wrapped constructor.
export type GmailFreshExecutor = GmailFreshExecutorOwner;

export const GmailFreshExecutor = instrumentDurableObjectWithSentry(
  sentryOptions,
  GmailFreshExecutorOwner
);
