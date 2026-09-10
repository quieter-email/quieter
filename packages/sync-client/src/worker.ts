/* oxlint-disable unicorn/require-post-message-target-origin -- Dedicated Worker messages have no target origin argument. */
import {
  syncBatchSchema,
  syncBodySchema,
  syncCheckpointSchema,
  syncSnapshotSchema,
} from "@quieter/sync";
import { z } from "zod";

import { MailSyncEngine } from "./engine";
import type { SyncApi } from "./types";
import {
  syncReceiptSchema,
  syncWorkerActionSchema,
  syncWorkerErrorSchema,
} from "./worker-protocol";
import type { SyncApiRequest } from "./worker-protocol";

const pending = new Map<
  number,
  {
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
    cleanup: () => void;
  }
>();
let nextId = 0;
let engine: MailSyncEngine | null = null;
let initialized = false;

const request = async (input: SyncApiRequest, signal: AbortSignal) => {
  signal.throwIfAborted();
  const id = nextId;
  nextId += 1;
  const deferred = Promise.withResolvers<unknown>();
  const cancel = () => {
    pending.delete(id);
    globalThis.postMessage({ id, type: "cancel" });
    deferred.reject(signal.reason);
  };
  signal.addEventListener("abort", cancel, { once: true });
  pending.set(id, {
    ...deferred,
    cleanup: () => {
      signal.removeEventListener("abort", cancel);
    },
  });
  globalThis.postMessage({ id, request: input, type: "api" });
  return await deferred.promise;
};

const api: SyncApi = {
  body: async (mailboxId, messageId, hash, signal) =>
    syncBodySchema.parse(
      await request(
        { input: { hash, mailboxId, messageId }, method: "body" },
        signal
      )
    ),
  command: async (mailboxId, commandId, signal) =>
    syncReceiptSchema
      .nullable()
      .parse(
        await request(
          { input: { commandId, mailboxId }, method: "command" },
          signal
        )
      ),
  connection: async (signal) =>
    z
      .object({ url: z.string().nullable() })
      .parse(await request({ input: null, method: "connection" }, signal)),
  hydrate: async (mailboxId, threadIds, signal) =>
    syncSnapshotSchema
      .nullable()
      .parse(
        await request(
          { input: { mailboxId, threadIds }, method: "hydrate" },
          signal
        )
      ),
  replay: async (mailboxId, checkpoint, signal) =>
    z
      .object({
        batches: z.array(syncBatchSchema),
        checkpoint: syncCheckpointSchema,
        hasMore: z.boolean(),
        reset: z.boolean(),
      })
      .parse(
        await request(
          { input: { checkpoint, mailboxId }, method: "replay" },
          signal
        )
      ),
  snapshot: async (mailboxId, signal) =>
    syncSnapshotSchema
      .nullable()
      .parse(
        await request({ input: { mailboxId }, method: "snapshot" }, signal)
      ),
  submit: async (command, signal) =>
    syncReceiptSchema.parse(
      await request({ input: command, method: "submit" }, signal)
    ),
};

const receive = async (raw: unknown) => {
  const response = z
    .object({
      error: syncWorkerErrorSchema.optional(),
      id: z.number(),
      result: z.unknown().optional(),
      type: z.literal("api-result"),
    })
    .safeParse(raw);
  if (response.success) {
    const waiting = pending.get(response.data.id);
    if (waiting === undefined) {
      return;
    }
    pending.delete(response.data.id);
    waiting.cleanup();
    if (response.data.error === undefined) {
      waiting.resolve(response.data.result);
    } else {
      waiting.reject(
        Object.assign(new Error(response.data.error.message), {
          code: response.data.error.code,
        })
      );
    }
    return;
  }
  const command = z
    .object({
      action: syncWorkerActionSchema,
      id: z.number(),
      type: z.literal("action"),
    })
    .safeParse(raw);
  if (!command.success) {
    return;
  }
  const { id, action } = command.data;
  try {
    let result: unknown = null;
    if (action.method === "initialize") {
      if (initialized) {
        throw new Error("The mail worker is already initialized.");
      }
      initialized = true;
      engine = await MailSyncEngine.create({
        ...action.input,
        api,
        onEvent: (event) => {
          if (event.type === "error") {
            const error = syncWorkerErrorSchema.safeParse(event.error);
            globalThis.postMessage({
              event: {
                ...event,
                error: error.success
                  ? error.data
                  : { message: "Mail synchronization failed." },
              },
              type: "event",
            });
          } else {
            globalThis.postMessage({ event, type: "event" });
          }
        },
      });
    } else {
      if (engine === null) {
        throw new Error("The mail worker is not initialized.");
      }
      switch (action.method) {
        case "subscribe": {
          await engine.subscribe(action.input.mailboxIds);
          break;
        }
        case "warm": {
          engine.warmThreads(
            action.input.mailboxId,
            action.input.threadIds,
            action.input.priority
          );
          break;
        }
        case "pin": {
          engine.pinThreads(action.input.mailboxId, action.input.threadIds);
          break;
        }
        case "thread": {
          result = await engine.thread(
            action.input.mailboxId,
            action.input.threadId
          );
          break;
        }
        case "command": {
          result = await engine.command(action.input);
          break;
        }
        case "visible": {
          await engine.setVisible(action.input);
          break;
        }
        case "online": {
          engine.setOnline(action.input);
          break;
        }
        case "budget": {
          await engine.setBudget(action.input);
          break;
        }
        case "clear-cache": {
          await engine.clearCache();
          break;
        }
        case "persistence": {
          await engine.setPersistence(action.input);
          break;
        }
        case "revoke": {
          await engine.revoke(action.input.mailboxId);
          break;
        }
        case "stop": {
          await engine.stop(action.input.purge);
          break;
        }
        default: {
          throw new Error("Unsupported mail worker action.");
        }
      }
    }
    globalThis.postMessage({ id, result, type: "result" });
  } catch (error) {
    const parsed = syncWorkerErrorSchema.safeParse(error);
    globalThis.postMessage({
      error: parsed.success
        ? parsed.data
        : { message: "Mail synchronization failed." },
      id,
      type: "result",
    });
  }
};

globalThis.addEventListener("message", (event: MessageEvent<unknown>) => {
  void receive(event.data);
});
