import { serverEnv } from "@quieter/env/server";
import {
  mailSnoozeDispatchResultSchema,
  mailSnoozeDispatchSchema,
  mailSnoozeScopeSchema,
} from "@quieter/mail/snooze-ticket";
import type { MailSnoozeScope } from "@quieter/mail/snooze-ticket";
import { signMailPayload } from "@quieter/mail/updates";
import { DurableObject } from "cloudflare:workers";

import { readLinkedSecret, reportWorkerError } from "./worker-runtime";

export class MailSnooze extends DurableObject<Env> {
  async fetch(request: Request) {
    if (request.method !== "POST") {
      return new Response(null, { headers: { allow: "POST" }, status: 405 });
    }
    const scope = mailSnoozeScopeSchema.parse(await request.json());
    await this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get("scope");
      const previous = mailSnoozeScopeSchema.safeParse(stored);
      if (
        previous.success &&
        (previous.data.id !== scope.id ||
          previous.data.mailboxId !== scope.mailboxId)
      ) {
        throw new Error("Snooze scope cannot change.");
      }
      await this.ctx.storage.put({ scope, wakeToken: crypto.randomUUID() });
      await this.ctx.storage.setAlarm(Date.now() + 100);
    });
    return new Response(null, { status: 204 });
  }

  async alarm() {
    try {
      const pending = await this.ctx.blockConcurrencyWhile(async () => {
        const stored = await this.ctx.storage.get("scope");
        const scope = mailSnoozeScopeSchema.safeParse(stored);
        if (!scope.success) {
          await this.ctx.storage.deleteAlarm();
          return null;
        }
        const wakeToken =
          (await this.ctx.storage.get<string>("wakeToken")) ??
          crypto.randomUUID();
        await this.ctx.storage.put("wakeToken", wakeToken);
        await this.ctx.storage.setAlarm(Date.now() + 120_000);
        return { scope: scope.data, wakeToken };
      });
      if (pending === null) {
        return;
      }
      const { nextWakeAt } = await this.dispatch(pending.scope);
      await this.ctx.blockConcurrencyWhile(async () => {
        const currentWakeToken = await this.ctx.storage.get("wakeToken");
        if (currentWakeToken !== pending.wakeToken) {
          return;
        }
        if (nextWakeAt === null) {
          await this.ctx.storage.deleteAlarm();
          await this.ctx.storage.delete(["scope", "wakeToken"]);
        } else {
          await this.ctx.storage.setAlarm(
            Math.max(Date.now() + 100, nextWakeAt)
          );
        }
      });
    } catch (error) {
      reportWorkerError(error, {
        category: "mail_snooze_alarm_error",
        route: "mail-snooze-alarm",
      });
      throw error;
    }
  }

  private async dispatch(scope: MailSnoozeScope) {
    const origin = serverEnv.BETTER_AUTH_URL;
    if (!origin) {
      throw new Error("Snooze origin is not configured.");
    }
    const body = JSON.stringify(
      mailSnoozeDispatchSchema.parse({
        ...scope,
        expiresAt: Date.now() + 30_000,
        purpose: "mail-snooze-dispatch",
      })
    );
    const response = await fetch(new URL("/api/internal/mail-snooze", origin), {
      body,
      headers: {
        "content-type": "application/json",
        "x-mail-signature": await signMailPayload(
          body,
          readLinkedSecret(this.env.SST_RESOURCE_GmailLiveSyncTokenSecret)
        ),
      },
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) {
      throw new Error("Snooze dispatch failed.");
    }
    return mailSnoozeDispatchResultSchema.parse(await response.json());
  }
}
