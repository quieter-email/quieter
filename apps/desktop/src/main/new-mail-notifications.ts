import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";

import type {
  NewMailNotificationContext,
  NewMailNotificationResult,
} from "@quieter/app/runtime";
import { z } from "zod";

import {
  newMailNotificationCapture,
  newMailNotificationDelivery,
} from "../shared/bridge";
import type {
  NewMailNotificationAuthority,
  NewMailNotificationPreferenceService,
} from "./new-mail-notification-preferences";

const receipt = z.strictObject({
  expiresAt: z.number().int().nonnegative(),
  key: z.string().regex(/^[a-f0-9]{64}$/u),
});
const savedReceipts = z.strictObject({
  highWater: z.number().int().nonnegative(),
  receipts: z.array(receipt).max(2000),
  version: z.literal(1),
});

export type NewMailPopup = {
  on: (
    event: "show" | "failed" | "click" | "close",
    listener: () => void
  ) => void;
  show: () => void;
  close: () => void;
  removeAllListeners: () => void;
};
type Context = {
  authority: NewMailNotificationAuthority;
  mailboxId: string;
};
type Retained = {
  context: Context;
  popup: NewMailPopup;
  settle: (result: NewMailNotificationResult) => void;
};

export class NewMailNotificationService {
  private readonly options;
  private readonly contexts = new Map<string, Context>();
  private readonly retained = new Map<string, Retained>();
  private readonly quietUntil = new Map<string, number>();
  private readonly work = new Set<Promise<unknown>>();
  private readonly unsubscribe;
  private operations: Promise<unknown> = Promise.resolve();
  private saved: z.infer<typeof savedReceipts> | undefined;
  private stopped = false;
  private capturing = 0;
  private queued = 0;

  constructor(options: {
    preferences: NewMailNotificationPreferenceService;
    filename: () => string;
    availability: () => "supported" | "unsupported" | "denied";
    isForeground: () => boolean;
    createPopup: (
      text: Readonly<{ title: string; body: string }>
    ) => NewMailPopup;
    openOwnedIntent: (
      input: Readonly<{
        owner: NewMailNotificationAuthority["owner"];
        target: Readonly<{
          kind: "mail";
          mailboxId: string;
          messageId: string;
          threadId: string;
        }>;
        isCurrent: () => boolean;
        signal: AbortSignal;
      }>
    ) => Promise<void>;
    onError: (error: unknown) => void;
    now?: () => number;
    receiptCapacity?: number;
  }) {
    this.options = options;
    this.unsubscribe = options.preferences.watchInvalidation((mailboxKey) => {
      for (const [id, context] of this.contexts) {
        if (!mailboxKey || context.authority.mailboxKey === mailboxKey) {
          this.contexts.delete(id);
        }
      }
      for (const [key, retained] of this.retained) {
        if (
          !mailboxKey ||
          retained.context.authority.mailboxKey === mailboxKey
        ) {
          retained.settle("inactive");
          retained.popup.removeAllListeners();
          retained.popup.close();
          this.retained.delete(key);
        }
      }
      if (mailboxKey) {
        this.quietUntil.delete(mailboxKey);
      } else {
        this.quietUntil.clear();
      }
    });
  }

  async capture(
    rawInput: unknown,
    isCurrent: () => boolean
  ): Promise<NewMailNotificationContext> {
    const input = newMailNotificationCapture.parse(rawInput);
    if (this.stopped || !isCurrent()) {
      return { kind: "inactive" };
    }
    if (this.capturing >= 8) {
      return { kind: "blocked" };
    }
    this.capturing += 1;
    const operation = (async (): Promise<NewMailNotificationContext> => {
      try {
        for (const [id, context] of this.contexts) {
          if (!context.authority.isCurrent()) {
            this.contexts.delete(id);
          } else if (
            context.mailboxId === input.mailboxId &&
            context.authority.owner.userId === input.userId
          ) {
            const availability = this.options.availability();
            if (availability === "unsupported") {
              return { kind: "unsupported" };
            }
            if (availability === "denied") {
              return { kind: "blocked" };
            }
            return { contextId: id, kind: "enabled" };
          }
        }
        const authority = await this.options.preferences.captureAuthority(
          { ...input, kind: "get-status" },
          isCurrent
        );
        if (this.stopped || !isCurrent()) {
          return { kind: "inactive" };
        }
        if (authority.kind !== "enabled") {
          return { kind: authority.kind };
        }
        if (!authority.isCurrent()) {
          return { kind: "inactive" };
        }
        const availability = this.options.availability();
        if (availability === "unsupported") {
          return { kind: "unsupported" };
        }
        if (availability === "denied") {
          return { kind: "blocked" };
        }
        if (this.contexts.size >= 100) {
          return { kind: "blocked" };
        }
        const contextId = randomUUID();
        this.contexts.set(contextId, { authority, mailboxId: input.mailboxId });
        return { contextId, kind: "enabled" };
      } catch (error) {
        if (!this.stopped && isCurrent()) {
          this.options.onError(error);
        }
        return { kind: this.stopped || !isCurrent() ? "inactive" : "blocked" };
      }
    })();
    this.work.add(operation);
    try {
      return await operation;
    } finally {
      this.capturing -= 1;
      this.work.delete(operation);
    }
  }

  async show(
    rawInput: unknown,
    isCurrent: () => boolean
  ): Promise<NewMailNotificationResult> {
    const input = newMailNotificationDelivery.parse(rawInput);
    const context = this.contexts.get(input.contextId);
    if (
      this.stopped ||
      !isCurrent() ||
      context?.authority.isCurrent() !== true ||
      context.mailboxId !== input.mailboxId ||
      this.queued >= 100
    ) {
      return "inactive";
    }
    const arrivedAt = this.options.now?.() ?? Date.now();
    const quiet = this.options.isForeground();
    const previous = this.operations;
    this.queued += 1;
    const operation = (async () => {
      await previous;
      try {
        return await this.handle(input, context, isCurrent, quiet, arrivedAt);
      } catch (error) {
        if (!this.stopped && context.authority.isCurrent() && isCurrent()) {
          this.options.onError(error);
        }
        return this.stopped || !context.authority.isCurrent() || !isCurrent()
          ? "inactive"
          : "blocked";
      } finally {
        this.queued -= 1;
      }
    })();
    this.operations = Promise.allSettled([operation]);
    const finished = (async (): Promise<NewMailNotificationResult> => {
      const result = await operation;
      return typeof result === "string" ? result : await result.pending;
    })();
    this.work.add(finished);
    try {
      return await finished;
    } finally {
      this.work.delete(finished);
    }
  }

  private async handle(
    input: z.infer<typeof newMailNotificationDelivery>,
    context: Context,
    isCurrent: () => boolean,
    quiet: boolean,
    arrivedAt: number
  ): Promise<
    NewMailNotificationResult | { pending: Promise<NewMailNotificationResult> }
  > {
    const current = () =>
      !this.stopped &&
      isCurrent() &&
      this.contexts.get(input.contextId) === context &&
      context.authority.isCurrent();
    if (!current() || !(await context.authority.validate()) || !current()) {
      return "inactive";
    }
    if (this.saved === undefined) {
      try {
        const value: unknown = JSON.parse(
          await readFile(this.options.filename(), "utf-8")
        );
        this.saved = savedReceipts.parse(value);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          this.saved = { highWater: 0, receipts: [], version: 1 };
        } else {
          throw error;
        }
      }
      if (!current() || !(await context.authority.validate()) || !current()) {
        return "inactive";
      }
    }
    const clock = this.options.now?.() ?? Date.now();
    const now = Math.max(clock, this.saved.highWater);
    const receivedAt = Date.parse(input.receivedAt);
    if (receivedAt > clock + 60_000 || now - receivedAt > 5 * 60_000) {
      return "stale";
    }
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          context.authority.accountKey,
          input.mailboxId,
          input.messageId,
        ])
      )
      .digest("hex");
    if (this.saved.receipts.some((entry) => entry.key === key)) {
      return "duplicate";
    }
    const receipts = this.saved.receipts.filter(
      (entry) => entry.expiresAt >= now
    );
    if (
      receipts.length >= Math.min(this.options.receiptCapacity ?? 2000, 2000)
    ) {
      return "blocked";
    }
    receipts.push({ expiresAt: receivedAt + 5 * 60_000, key });
    const next = savedReceipts.parse({ highWater: now, receipts, version: 1 });
    const filename = this.options.filename();
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(next)}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      if (!current() || !(await context.authority.validate()) || !current()) {
        return "inactive";
      }
      await rename(temporary, filename);
      this.saved = next;
    } finally {
      await rm(temporary, { force: true });
    }
    if (!current() || !(await context.authority.validate()) || !current()) {
      return "inactive";
    }
    const finalClock = this.options.now?.() ?? Date.now();
    if (
      Math.max(finalClock, this.saved.highWater) - receivedAt > 5 * 60_000 ||
      receivedAt > finalClock + 60_000
    ) {
      return "stale";
    }
    const mailboxQuiet =
      arrivedAt < (this.quietUntil.get(context.authority.mailboxKey) ?? 0);
    this.quietUntil.set(
      context.authority.mailboxKey,
      Math.max(
        this.quietUntil.get(context.authority.mailboxKey) ?? 0,
        arrivedAt + 30_000
      )
    );
    if (
      quiet ||
      mailboxQuiet ||
      this.options.isForeground() ||
      finalClock - arrivedAt > 30_000
    ) {
      return "quiet";
    }
    const availability = this.options.availability();
    if (availability !== "supported") {
      return "blocked";
    }
    if (this.retained.size >= 100) {
      return "quiet";
    }
    const popup = this.options.createPopup({
      body: "Open quieter to read your new email.",
      title: "New email",
    });
    const completion = Promise.withResolvers<NewMailNotificationResult>();
    const timer = setTimeout(() => {
      this.options.onError(
        new Error("New-mail notification display timed out.")
      );
      this.retained.delete(key);
      popup.removeAllListeners();
      popup.close();
      completion.resolve("blocked");
    }, 15_000);
    const settle = (result: NewMailNotificationResult) => {
      clearTimeout(timer);
      completion.resolve(result);
    };
    this.retained.set(key, { context, popup, settle });
    popup.on("show", () => {
      if (current()) {
        settle("shown");
      } else {
        popup.removeAllListeners();
        popup.close();
        this.retained.delete(key);
        settle("inactive");
      }
    });
    popup.on("failed", () => {
      this.options.onError(new Error("New-mail notification display failed."));
      popup.removeAllListeners();
      popup.close();
      this.retained.delete(key);
      settle("blocked");
    });
    popup.on("close", () => {
      this.retained.delete(key);
      popup.removeAllListeners();
      settle("inactive");
    });
    popup.on("click", () => {
      const click = (async () => {
        try {
          if (
            !current() ||
            !(await context.authority.validate()) ||
            !current()
          ) {
            return;
          }
          await this.options.openOwnedIntent({
            isCurrent: current,
            owner: context.authority.owner,
            signal: context.authority.signal,
            target: {
              kind: "mail",
              mailboxId: input.mailboxId,
              messageId: input.messageId,
              threadId: input.threadId,
            },
          });
        } catch (error) {
          if (current()) {
            this.options.onError(error);
          }
        }
      })();
      this.work.add(click);
      void (async () => {
        try {
          await click;
        } finally {
          this.work.delete(click);
        }
      })();
    });
    try {
      popup.show();
    } catch (error) {
      popup.removeAllListeners();
      popup.close();
      this.retained.delete(key);
      settle("blocked");
      this.options.onError(error);
    }
    return { pending: completion.promise };
  }

  async stop(): Promise<void> {
    if (!this.stopped) {
      this.stopped = true;
      this.options.preferences.invalidate();
      this.unsubscribe();
    }
    await this.operations;
    await Promise.allSettled(this.work);
  }
}
