import { withRequestDatabaseClient } from "@quieter/database/client";
import { reminderWakeSchema } from "@quieter/mail/reminders";
import { advanceReminderScope } from "@quieter/orpc/reminders/clock";
import { DurableObject } from "cloudflare:workers";

import { reportWorkerError } from "./worker-runtime";

const scopeSchema = reminderWakeSchema.omit({ expiresAt: true, purpose: true });

export class ReminderMailbox extends DurableObject<Env> {
  async fetch(request: Request) {
    if (request.method !== "POST") {
      return new Response(null, { status: 405 });
    }
    const scope = scopeSchema.parse(await request.json());
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.ctx.storage.put("scope", scope);
      await this.advance(scope);
    });
    return new Response(null, { status: 204 });
  }

  async alarm() {
    try {
      await this.ctx.blockConcurrencyWhile(async () => {
        const stored = await this.ctx.storage.get("scope");
        const scope = scopeSchema.safeParse(stored);
        if (!scope.success) {
          await this.ctx.storage.deleteAlarm();
          return;
        }
        await this.advance(scope.data);
      });
    } catch (error) {
      reportWorkerError(error, {
        category: "reminder_alarm_error",
        route: "reminder-alarm",
      });
      throw error;
    }
  }

  private async advance(scope: { mailboxId: string; userId: string }) {
    await this.ctx.storage.setAlarm(Date.now() + 30_000);
    const { nextWakeAt } = await withRequestDatabaseClient(
      async () => await advanceReminderScope(scope)
    );
    if (nextWakeAt === null) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(Math.max(Date.now() + 100, nextWakeAt));
    }
  }
}
