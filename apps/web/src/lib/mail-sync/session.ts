import type { MailCommand, MailMutationTarget } from "@quieter/mail/data-plane";
import type { SyncClientEvent } from "@quieter/sync-client/types";
import { MailSyncWorkerClient } from "@quieter/sync-client/worker-client";
import * as Sentry from "@sentry/tanstackstart-react";
import type { QueryClient } from "@tanstack/react-query";
import { Store } from "@tanstack/store";

import { isExpectedClientError } from "#/lib/client-error-reporting";
import { setMailReplicaPersistence } from "#/lib/query-persister";

import { mailSyncApi } from "./api";
import { MailSyncQueryAdapter } from "./query-adapter";

type CacheStatus = Extract<SyncClientEvent, { type: "status" }>;
export const mailSyncState = new Store<{
  mailboxIds: string[];
  status: CacheStatus | null;
}>({ mailboxIds: [], status: null });
let current: MailSyncSession | null = null;

export const reportMailSyncError = (error: unknown) => {
  if (
    typeof error === "object" &&
    error !== null &&
    (("name" in error && error.name === "AbortError") ||
      ("code" in error &&
        ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT"].includes(
          String(error.code)
        )))
  ) {
    return;
  }
  if (
    typeof navigator !== "undefined" &&
    navigator.onLine &&
    !isExpectedClientError(error)
  ) {
    Sentry.captureException(error, { tags: { boundary: "mail_sync_client" } });
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
  private mailboxIds = new Set<string>();

  private constructor(userId: string, queryClient: QueryClient) {
    this.adapter = new MailSyncQueryAdapter(queryClient);
    this.client = new MailSyncWorkerClient(
      new Worker(new URL("worker.ts", import.meta.url), { type: "module" }),
      mailSyncApi,
      {
        mobile: matchMedia("(pointer: coarse)").matches,
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
        if (event.type === "status") {
          mailSyncState.setState((state) => ({ ...state, status: event }));
        } else if (event.type === "revoked") {
          this.mailboxIds.delete(event.mailboxId);
          mailSyncState.setState((state) => ({
            ...state,
            mailboxIds: [...this.mailboxIds],
          }));
        } else if (event.type === "error") {
          reportMailSyncError(event.error);
        }
      }
    );
  }

  static start(userId: string, queryClient: QueryClient) {
    const session = new MailSyncSession(userId, queryClient);
    current = session;
    setMailReplicaPersistence(true);
    return session;
  }

  async subscribe(mailboxes: { id: string; provider: "gmail" | "managed" }[]) {
    const next = new Set(mailboxes.map((mailbox) => mailbox.id));
    for (const mailboxId of this.mailboxIds) {
      if (!next.has(mailboxId)) {
        await this.client.action({ input: { mailboxId }, method: "revoke" });
      }
    }
    this.mailboxIds = next;
    this.adapter.setMailboxes(mailboxes);
    await this.client.action({
      input: { mailboxIds: [...next] },
      method: "subscribe",
    });
    if (current === this) {
      mailSyncState.setState((state) => ({ ...state, mailboxIds: [...next] }));
    }
  }

  static forMailbox(mailboxId: string) {
    return current?.mailboxIds.has(mailboxId) === true &&
      mailSyncState.state.status?.connection !== "disabled"
      ? current
      : null;
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
    try {
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
    }
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
      setMailReplicaPersistence(false);
      mailSyncState.setState(() => ({ mailboxIds: [], status: null }));
    }
    this.adapter.dispose();
    await this.client.stop(purge);
  }
}
