/* oxlint-disable unicorn/require-post-message-target-origin -- Dedicated Worker messages have no target origin argument. */
import { syncBodySchema, syncMessageSchema } from "@quieter/sync";
import { z } from "zod";

import type { SyncApi, SyncClientEvent } from "./types";
import { syncReceiptSchema } from "./worker-protocol";
import type { SyncApiRequest, SyncWorkerAction } from "./worker-protocol";

type WorkerMessage =
  | { type: "event"; event: SyncClientEvent }
  | { type: "api"; id: number; request: SyncApiRequest }
  | { type: "cancel"; id: number }
  | {
      type: "result";
      id: number;
      result?: unknown;
      error?: { message: string; code?: string };
    };

export class MailSyncWorkerClient {
  private readonly pending = new Map<
    number,
    ReturnType<typeof Promise.withResolvers<unknown>>
  >();
  private readonly requests = new Map<number, AbortController>();
  private nextId = 0;
  private stopping = false;
  readonly ready: Promise<unknown>;
  private readonly worker: Worker;
  private readonly api: SyncApi;
  private readonly onEvent: (event: SyncClientEvent) => void;

  constructor(
    worker: Worker,
    api: SyncApi,
    initialize: Extract<SyncWorkerAction, { method: "initialize" }>["input"],
    onEvent: (event: SyncClientEvent) => void
  ) {
    this.worker = worker;
    this.api = api;
    this.onEvent = onEvent;
    worker.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === "result") {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error === undefined) {
          pending?.resolve(message.result);
        } else {
          pending?.reject(
            Object.assign(new Error(message.error.message), {
              code: message.error.code,
            })
          );
        }
      } else if (!this.stopping) {
        if (message.type === "event") {
          this.onEvent(message.event);
        } else if (message.type === "cancel") {
          this.requests.get(message.id)?.abort();
          this.requests.delete(message.id);
        } else {
          void this.executeApi(message.id, message.request);
        }
      }
    });
    worker.addEventListener("error", () => {
      const error = new Error(
        "The background mail cache stopped unexpectedly."
      );
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
      if (!this.stopping) {
        this.onEvent({ error, operation: "worker", type: "error" });
      }
    });
    this.ready = this.dispatch({ input: initialize, method: "initialize" });
  }

  private async dispatch(action: SyncWorkerAction) {
    const id = this.nextId;
    this.nextId += 1;
    const pending = Promise.withResolvers<unknown>();
    this.pending.set(id, pending);
    this.worker.postMessage({ action, id, type: "action" });
    return await pending.promise;
  }

  async action(
    action: Exclude<SyncWorkerAction, { method: "initialize" | "stop" }>
  ) {
    await this.ready;
    if (this.stopping) {
      throw new DOMException("Mail synchronization stopped.", "AbortError");
    }
    return await this.dispatch(action);
  }

  async thread(mailboxId: string, threadId: string) {
    return z
      .object({
        messages: z.array(
          syncMessageSchema.omit({ body: true }).extend(syncBodySchema.shape)
        ),
        snippet: z.string().optional(),
        subject: z.string().optional(),
        threadId: z.string(),
      })
      .parse(
        await this.action({ input: { mailboxId, threadId }, method: "thread" })
      );
  }

  async command(
    input: Extract<SyncWorkerAction, { method: "command" }>["input"]
  ) {
    return syncReceiptSchema.parse(
      await this.action({ input, method: "command" })
    );
  }

  async stop(purge: boolean) {
    this.stopping = true;
    for (const controller of this.requests.values()) {
      controller.abort();
    }
    this.requests.clear();
    try {
      await this.ready;
      await this.dispatch({ input: { purge }, method: "stop" });
    } finally {
      this.worker.terminate();
      for (const pending of this.pending.values()) {
        pending.reject(
          new DOMException("Mail synchronization stopped.", "AbortError")
        );
      }
      this.pending.clear();
    }
  }

  private async executeApi(id: number, request: SyncApiRequest) {
    const controller = new AbortController();
    this.requests.set(id, controller);
    const { signal } = controller;
    try {
      let result: unknown;
      switch (request.method) {
        case "connection": {
          result = await this.api.connection(signal);
          break;
        }
        case "snapshot": {
          result = await this.api.snapshot(request.input.mailboxId, signal);
          break;
        }
        case "replay": {
          result = await this.api.replay(
            request.input.mailboxId,
            request.input.checkpoint,
            signal
          );
          break;
        }
        case "hydrate": {
          result = await this.api.hydrate(
            request.input.mailboxId,
            request.input.threadIds,
            signal
          );
          break;
        }
        case "body": {
          result = await this.api.body(
            request.input.mailboxId,
            request.input.messageId,
            request.input.hash,
            signal
          );
          break;
        }
        case "submit": {
          result = await this.api.submit(request.input, signal);
          break;
        }
        case "command": {
          result = await this.api.command(
            request.input.mailboxId,
            request.input.commandId,
            signal
          );
          break;
        }
        default: {
          throw new Error("Unsupported mail cache request.");
        }
      }
      if (!signal.aborted && !this.stopping) {
        this.worker.postMessage({ id, result, type: "api-result" });
      }
    } catch (error) {
      if (!signal.aborted && !this.stopping) {
        const parsed = z
          .object({ code: z.string().optional(), message: z.string() })
          .safeParse(error);
        this.worker.postMessage({
          error: parsed.success
            ? parsed.data
            : { message: "Mail synchronization failed." },
          id,
          type: "api-result",
        });
      }
    } finally {
      this.requests.delete(id);
    }
  }
}
