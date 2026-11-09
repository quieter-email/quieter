import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ReminderNotificationEvent,
  ReminderNotifications,
  ReminderNotificationStatus,
} from "@quieter/app/runtime";
import { app, Notification } from "electron";
import { z } from "zod";

const savedNotifications = z.strictObject({
  delivered: z.array(z.string().regex(/^[\da-f]{64}$/u)).max(2000),
  enabledAccounts: z.array(z.string().regex(/^[\da-f]{64}$/u)).max(100),
});

type NotificationSession = { userId: string; sessionId: string };
type ShowResult = Awaited<ReturnType<ReminderNotifications["show"]>>;

export class ReminderNotificationService {
  private readonly options;
  private session: (NotificationSession & { accountKey: string }) | undefined;
  private generation = 0;
  private blocked = false;
  private ready = false;
  private enabledAccounts = new Set<string>();
  private delivered = new Set<string>();
  private readonly retained = new Map<string, Notification>();
  private readonly pending = new Map<string, (result: ShowResult) => void>();
  private write: Promise<unknown> = Promise.resolve();

  constructor(options: {
    origin: string;
    getSession: () => Promise<NotificationSession | null>;
    onOpen: (event: ReminderNotificationEvent) => void;
    onError: (error: unknown) => void;
  }) {
    this.options = options;
  }

  async initialize(): Promise<void> {
    try {
      const serialized = await readFile(
        path.join(app.getPath("userData"), "reminder-notifications.json"),
        "utf-8"
      );
      const saved = savedNotifications.parse(JSON.parse(serialized));
      this.enabledAccounts = new Set(saved.enabledAccounts);
      this.delivered = new Set(saved.delivered);
      this.ready = true;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        this.ready = true;
      } else {
        this.options.onError(error);
      }
    }
  }

  clearSession(): void {
    this.generation += 1;
    this.session = undefined;
    this.blocked = false;
    for (const settle of this.pending.values()) {
      settle("inactive");
    }
    this.pending.clear();
    for (const notification of this.retained.values()) {
      notification.removeAllListeners();
      notification.close();
    }
    this.retained.clear();
    if (process.platform === "darwin" && Notification.isSupported()) {
      Notification.removeAll();
    }
  }

  async setUser(userId: string | null): Promise<void> {
    if (userId === null || this.session?.userId !== userId) {
      this.clearSession();
    }
    if (userId === null) {
      return;
    }
    const { generation } = this;
    const session = await this.options.getSession();
    if (generation !== this.generation) {
      return;
    }
    if (
      session?.userId === userId &&
      this.session?.sessionId === session.sessionId
    ) {
      return;
    }
    this.clearSession();
    if (session?.userId === userId) {
      this.session = {
        ...session,
        accountKey: createHash("sha256")
          .update(JSON.stringify([this.options.origin, session.userId]))
          .digest("hex"),
      };
    }
  }

  getStatus(): ReminderNotificationStatus {
    if (!Notification.isSupported()) {
      return "unsupported";
    }
    if (!this.ready || this.blocked) {
      return "blocked";
    }
    const { session } = this;
    return session && this.enabledAccounts.has(session.accountKey)
      ? "enabled"
      : "disabled";
  }

  async setEnabled(enabled: boolean): Promise<ReminderNotificationStatus> {
    const { session } = this;
    if (!session) {
      return "disabled";
    }
    const { generation } = this;
    const current = await this.options.getSession();
    if (
      generation !== this.generation ||
      current?.userId !== session.userId ||
      current.sessionId !== session.sessionId
    ) {
      return "disabled";
    }
    const account = session.accountKey;
    if (enabled) {
      this.enabledAccounts.add(account);
      while (this.enabledAccounts.size > 100) {
        this.enabledAccounts.delete(
          this.enabledAccounts.values().next().value ?? ""
        );
      }
      this.blocked = false;
    } else {
      this.enabledAccounts.delete(account);
      this.clearSession();
      this.session = { ...current, accountKey: account };
    }
    await this.persist();
    return this.getStatus();
  }

  async show(event: ReminderNotificationEvent): Promise<ShowResult> {
    const status = this.getStatus();
    if (status !== "enabled") {
      return status;
    }
    const { session } = this;
    if (!session || this.pending.size >= 20) {
      return "inactive";
    }
    const { generation } = this;
    const current = await this.options.getSession();
    if (
      generation !== this.generation ||
      current?.userId !== session.userId ||
      current.sessionId !== session.sessionId
    ) {
      return "inactive";
    }
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          session.accountKey,
          event.mailboxId,
          event.reminderId,
          event.scheduleVersion,
        ])
      )
      .digest("hex");
    if (this.delivered.has(key) || this.pending.has(key)) {
      return "duplicate";
    }
    if (this.pending.size >= 20) {
      return "inactive";
    }
    const notification = new Notification({
      body: "Open quieter to see your reminder.",
      title: "Reminder due",
    });
    this.retained.set(key, notification);
    while (this.retained.size > 100) {
      const oldest = this.retained.entries().next().value;
      if (oldest) {
        oldest[1].removeAllListeners();
        oldest[1].close();
        this.retained.delete(oldest[0]);
        this.pending.get(oldest[0])?.("inactive");
      }
    }
    const { promise, resolve } = Promise.withResolvers<ShowResult>();
    const timer = setTimeout(() => {
      this.blocked = true;
      notification.removeAllListeners();
      notification.close();
      this.retained.delete(key);
      this.pending.get(key)?.("blocked");
    }, 15_000);
    const settle = (result: ShowResult) => {
      clearTimeout(timer);
      this.pending.delete(key);
      resolve(result);
    };
    this.pending.set(key, settle);
    notification.once("show", () => {
      if (generation !== this.generation) {
        notification.close();
        settle("inactive");
        return;
      }
      this.delivered.add(key);
      while (this.delivered.size > 2000) {
        this.delivered.delete(this.delivered.values().next().value ?? "");
      }
      // Record delivery only after the OS accepts it. A crash before this write can repeat a notification.
      void (async () => {
        try {
          await this.persist();
        } catch (error) {
          this.options.onError(error);
        }
      })();
      settle("shown");
    });
    notification.once("failed", () => {
      this.blocked = true;
      notification.removeAllListeners();
      notification.close();
      this.retained.delete(key);
      settle("blocked");
    });
    notification.on("click", () => {
      void (async () => {
        try {
          const active = await this.options.getSession();
          if (
            generation === this.generation &&
            active?.userId === session.userId &&
            active.sessionId === session.sessionId
          ) {
            this.options.onOpen(event);
          }
        } catch (error) {
          this.options.onError(error);
        }
      })();
    });
    try {
      notification.show();
    } catch (error) {
      this.options.onError(error);
      this.blocked = true;
      notification.removeAllListeners();
      notification.close();
      this.retained.delete(key);
      settle("blocked");
    }
    return await promise;
  }

  async flush(): Promise<void> {
    await this.write;
  }

  private async persist(): Promise<void> {
    const serialized = JSON.stringify({
      delivered: [...this.delivered],
      enabledAccounts: [...this.enabledAccounts],
    });
    const previous = this.write;
    const operation = (async () => {
      await previous;
      const destination = path.join(
        app.getPath("userData"),
        "reminder-notifications.json"
      );
      await writeFile(`${destination}.tmp`, serialized, { mode: 0o600 });
      await rename(`${destination}.tmp`, destination);
    })();
    this.write = Promise.allSettled([operation]);
    await operation;
  }
}
