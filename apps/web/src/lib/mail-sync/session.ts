import type { MailCommand, MailMutationTarget } from "@quieter/mail/data-plane";
import { DraftJournal } from "@quieter/sync-client/draft-journal";
import type { SyncClientEvent } from "@quieter/sync-client/types";
import { MailSyncWorkerClient } from "@quieter/sync-client/worker-client";
import * as Sentry from "@sentry/tanstackstart-react";
import type { QueryClient } from "@tanstack/react-query";
import { Store } from "@tanstack/store";

import { isExpectedClientError } from "#/lib/client-error-reporting";
import { rpc } from "#/lib/orpc";

import { mailSyncApi } from "./api";
import { recordMailSyncMeasurement } from "./measurements";
import { MailSyncQueryAdapter } from "./query-adapter";

type CacheStatus = Extract<SyncClientEvent, { type: "status" }>;
export const mailSyncState = new Store<{
  mailboxIds: string[];
  status: CacheStatus | null;
}>({ mailboxIds: [], status: null });
let current: MailSyncSession | null = null;
const MAIL_CACHE_PREFERENCE = "quieter:mail-cache:persistent";

const shouldPersistMail = () => {
  try {
    return localStorage.getItem(MAIL_CACHE_PREFERENCE) !== "false";
  } catch {
    return false;
  }
};

export const reportMailSyncError = (error: unknown) => {
  if (
    typeof error === "object" &&
    error !== null &&
    (("name" in error && error.name === "AbortError") ||
      ("code" in error &&
        [
          "UNAUTHORIZED",
          "FORBIDDEN",
          "NOT_FOUND",
          "CONFLICT",
          "SYNC_NOT_READY",
        ].includes(String(error.code))))
  ) {
    return;
  }
  if (
    typeof navigator !== "undefined" &&
    navigator.onLine &&
    !isExpectedClientError(error)
  ) {
    const exception =
      !(error instanceof Error) &&
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string"
        ? Object.assign(new Error(error.message), {
            name:
              "name" in error && typeof error.name === "string"
                ? error.name
                : "Error",
          })
        : error;
    Sentry.captureException(exception, {
      tags: { boundary: "mail_sync_client" },
    });
  }
};

export const runMailSyncTask = async (task: Promise<unknown> | undefined) => {
  try {
    await task;
  } catch (error) {
    reportMailSyncError(error);
  }
};

export class MailSyncSession {
  readonly client: MailSyncWorkerClient;
  readonly adapter: MailSyncQueryAdapter;
  readonly drafts: Promise<DraftJournal | null>;
  private mailboxIds = new Set<string>();
  private readonly commandQueues = new Map<string, Promise<null>>();

  private constructor(userId: string, queryClient: QueryClient) {
    this.drafts = (async () => {
      try {
        return await DraftJournal.open(userId);
      } catch (error) {
        reportMailSyncError(error);
        return null;
      }
    })();
    this.adapter = new MailSyncQueryAdapter(queryClient);
    this.client = new MailSyncWorkerClient(
      new Worker(new URL("worker.ts", import.meta.url), { type: "module" }),
      mailSyncApi,
      {
        mobile: matchMedia("(pointer: coarse)").matches,
        persistent: shouldPersistMail(),
        reducedData:
          "connection" in navigator &&
          typeof navigator.connection === "object" &&
          navigator.connection !== null &&
          "saveData" in navigator.connection &&
          navigator.connection.saveData === true,
        userId,
      },
      (event) => {
        if (current !== this) {
          return;
        }
        this.adapter.receive(event);
        if (event.type === "measurement") {
          recordMailSyncMeasurement(event.name, event.value);
        }
        if (event.type === "status") {
          recordMailSyncMeasurement("cache-bytes", event.cacheBytes);
          mailSyncState.setState((state) => ({ ...state, status: event }));
        } else if (event.type === "revoked") {
          void runMailSyncTask(
            (async () => {
              const journal = await this.drafts;
              await journal?.revoke(event.mailboxId);
            })()
          );
          this.mailboxIds.delete(event.mailboxId);
          mailSyncState.setState((state) => ({
            ...state,
            mailboxIds: [...this.mailboxIds],
          }));
        } else if (event.type === "error") {
          if (
            event.error instanceof Error &&
            event.error.name === "QuotaExceededError"
          ) {
            recordMailSyncMeasurement("cache-quota-error", 1);
          }
          reportMailSyncError(event.error);
        } else if (event.type === "session-ended") {
          void runMailSyncTask(this.stop(true));
          window.location.reload();
        }
      }
    );
  }

  static start(userId: string, queryClient: QueryClient) {
    const session = new MailSyncSession(userId, queryClient);
    current = session;

    return session;
  }

  async setPersistence(persistent: boolean) {
    await this.client.action({ input: persistent, method: "persistence" });
    localStorage.setItem(MAIL_CACHE_PREFERENCE, String(persistent));
  }

  async subscribe(mailboxes: { id: string; provider: "gmail" | "managed" }[]) {
    const next = new Set(mailboxes.map((mailbox) => mailbox.id));
    const journal = await this.drafts;
    for (const mailboxId of this.mailboxIds) {
      if (!next.has(mailboxId)) {
        await journal?.revoke(mailboxId);
        await this.client.action({ input: { mailboxId }, method: "revoke" });
      }
    }
    this.mailboxIds = next;
    await Promise.all(
      [...next].map(async (mailboxId) => {
        await journal?.authorize(mailboxId);
      })
    );
    this.adapter.setMailboxes(mailboxes);
    if (current === this) {
      mailSyncState.setState((state) => ({ ...state, mailboxIds: [...next] }));
    }
    await this.client.action({
      input: { mailboxIds: [...next] },
      method: "subscribe",
    });
  }

  static forMailbox(mailboxId: string) {
    return current?.mailboxIds.has(mailboxId) === true &&
      mailSyncState.state.mailboxIds.includes(mailboxId)
      ? current
      : null;
  }

  static async waitForMailbox(mailboxId: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const ready = MailSyncSession.forMailbox(mailboxId);
    if (ready !== null) {
      return ready;
    }
    const owner = current;
    const pending = Promise.withResolvers<MailSyncSession>();
    const abort = () => {
      pending.reject(new DOMException("Mail request cancelled.", "AbortError"));
    };
    const timeout = setTimeout(() => {
      pending.reject(
        new Error("Mail synchronization is unavailable. Please retry.")
      );
    }, 20_000);
    const subscription = mailSyncState.subscribe(() => {
      if (owner !== null && current !== owner) {
        pending.reject(new DOMException("Mail session ended.", "AbortError"));
      } else {
        const session = MailSyncSession.forMailbox(mailboxId);
        if (session !== null) {
          pending.resolve(session);
        }
      }
    });
    signal?.addEventListener("abort", abort, { once: true });
    try {
      return await pending.promise;
    } finally {
      clearTimeout(timeout);
      subscription.unsubscribe();
      signal?.removeEventListener("abort", abort);
    }
  }

  async command(
    mailboxId: string,
    targets: MailMutationTarget[],
    command: MailCommand
  ) {
    if (!navigator.onLine) {
      throw Object.assign(
        new Error("Connect to the internet to make changes."),
        { status: 400 }
      );
    }
    const input = {
      command,
      commandId: crypto.randomUUID(),
      mailboxId,
      targets,
    };
    this.adapter.addCommand(input);
    const previous = this.commandQueues.get(mailboxId);
    const completed = Promise.withResolvers<null>();
    this.commandQueues.set(mailboxId, completed.promise);
    try {
      await previous;
      const receipt = await this.client.command(input);
      if (receipt.status === "failed") {
        throw Object.assign(
          new Error(receipt.error ?? "This change could not be applied."),
          { status: 400 }
        );
      }
      return receipt;
    } catch (error) {
      this.adapter.rejectCommand(input);
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        [
          "BAD_REQUEST",
          "FORBIDDEN",
          "UNAUTHORIZED",
          "NOT_FOUND",
          "CONFLICT",
        ].includes(String(error.code))
      ) {
        throw Object.assign(
          new Error(
            error instanceof Error
              ? error.message
              : "This change could not be applied.",
            { cause: error }
          ),
          { status: 400 }
        );
      }
      throw error;
    } finally {
      completed.resolve(null);
      if (this.commandQueues.get(mailboxId) === completed.promise) {
        this.commandQueues.delete(mailboxId);
      }
    }
  }

  async refresh(mailboxId: string) {
    await rpc.mail.refreshSyncMailbox({ mailboxId });
    await this.client.action({ input: { mailboxId }, method: "catch-up" });
  }

  warm(mailboxId: string, threadIds: string[], priority = 1) {
    void runMailSyncTask(
      this.client.action({
        input: { mailboxId, priority, threadIds },
        method: "warm",
      })
    );
  }

  async thread(mailboxId: string, threadId: string) {
    return this.adapter.projectThread(
      mailboxId,
      await this.client.thread(mailboxId, threadId)
    );
  }

  async stop(purge: boolean) {
    if (current === this) {
      current = null;

      mailSyncState.setState(() => ({ mailboxIds: [], status: null }));
    }
    this.adapter.dispose();
    await Promise.all([
      this.client.stop(purge),
      (async () => {
        const journal = await this.drafts;
        if (purge) {
          await journal?.purge();
        } else {
          journal?.close();
        }
      })(),
    ]);
  }
}
