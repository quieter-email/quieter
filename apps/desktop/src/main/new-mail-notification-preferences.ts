import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";

import type { NewMailNotificationPreferenceStatus } from "@quieter/app/runtime";
import { z } from "zod";

import type { NewMailNotificationPreferenceRequest } from "../shared/bridge";

const savedPreferences = z.strictObject({
  enabledMailboxes: z.array(z.string().regex(/^[a-f0-9]{64}$/u)).max(2000),
});

type NotificationSession = Readonly<{ userId: string; sessionId: string }>;

export class NewMailNotificationPreferenceService {
  private readonly options;
  private generation = 0;
  private controller = new AbortController();
  private enabledMailboxes: Set<string> | undefined;
  private operations: Promise<null> = Promise.resolve(null);

  constructor(options: {
    origin: string;
    filename: () => string;
    getSession: (signal: AbortSignal) => Promise<NotificationSession | null>;
    isSupported: () => boolean;
  }) {
    this.options = options;
  }

  invalidate(): void {
    this.generation += 1;
    this.controller.abort();
    this.controller = new AbortController();
  }

  async stop(): Promise<void> {
    this.invalidate();
    await this.operations;
  }

  async execute(
    input: NewMailNotificationPreferenceRequest,
    isCurrent: () => boolean
  ): Promise<NewMailNotificationPreferenceStatus> {
    const { controller, generation, operations: previous } = this;
    const { signal } = controller;
    const completion = Promise.withResolvers<null>();
    this.operations = completion.promise;
    const pendingSession = (async () => {
      try {
        return {
          session: isCurrent() ? await this.options.getSession(signal) : null,
        };
      } catch (error) {
        return { error };
      }
    })();
    try {
      await previous;
      const captured = await pendingSession;
      if (generation !== this.generation || !isCurrent()) {
        return { kind: "inactive" };
      }
      if ("error" in captured) {
        throw captured.error;
      }
      const initial = captured.session;
      if (initial?.userId !== input.userId) {
        return { kind: "inactive" };
      }
      const current = await this.options.getSession(signal);
      if (
        generation !== this.generation ||
        !isCurrent() ||
        current?.userId !== initial.userId ||
        current.sessionId !== initial.sessionId
      ) {
        return { kind: "inactive" };
      }
      const filename = this.options.filename();
      if (this.enabledMailboxes === undefined) {
        try {
          const value: unknown = JSON.parse(
            await readFile(filename, { encoding: "utf-8", signal })
          );
          this.enabledMailboxes = new Set(
            savedPreferences.parse(value).enabledMailboxes
          );
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          ) {
            this.enabledMailboxes = new Set();
          } else {
            throw error;
          }
        }
      }
      if (generation !== this.generation || !isCurrent()) {
        return { kind: "inactive" };
      }
      const session = await this.options.getSession(signal);
      if (
        generation !== this.generation ||
        !isCurrent() ||
        session?.userId !== initial.userId ||
        session.sessionId !== initial.sessionId
      ) {
        return { kind: "inactive" };
      }
      const key = createHash("sha256")
        .update(
          JSON.stringify([this.options.origin, session.userId, input.mailboxId])
        )
        .digest("hex");
      const supported = this.options.isSupported();
      if (input.kind === "get-status" || (input.enabled && !supported)) {
        return {
          enabled: this.enabledMailboxes.has(key),
          kind: "ready",
          supported,
        };
      }
      const next = new Set(this.enabledMailboxes);
      if (input.enabled) {
        next.add(key);
      } else {
        next.delete(key);
      }
      const saved = savedPreferences.parse({ enabledMailboxes: [...next] });
      const temporary = `${filename}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(saved)}\n`, {
          flag: "wx",
          mode: 0o600,
          signal,
        });
        if (generation !== this.generation || !isCurrent()) {
          return { kind: "inactive" };
        }
        const authorized = await this.options.getSession(signal);
        if (
          generation !== this.generation ||
          !isCurrent() ||
          authorized?.userId !== initial.userId ||
          authorized.sessionId !== initial.sessionId
        ) {
          return { kind: "inactive" };
        }
        await rename(temporary, filename);
        this.enabledMailboxes = next;
        if (generation !== this.generation || !isCurrent()) {
          return { kind: "inactive" };
        }
        const final = await this.options.getSession(signal);
        return generation === this.generation &&
          isCurrent() &&
          final?.userId === initial.userId &&
          final.sessionId === initial.sessionId
          ? {
              enabled: input.enabled,
              kind: "ready",
              supported: this.options.isSupported(),
            }
          : { kind: "inactive" };
      } finally {
        await rm(temporary, { force: true });
      }
    } catch (error) {
      if (signal.aborted) {
        return { kind: "inactive" };
      }
      throw error;
    } finally {
      completion.resolve(null);
    }
  }
}
