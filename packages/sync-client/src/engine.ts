import type { ThreadMessagesResult } from "@quieter/mail/messages";
import {
  syncChangeSchema,
  syncCheckpointSchema,
  syncCommandSchema,
} from "@quieter/sync";
import type { SyncBody, SyncCommand } from "@quieter/sync";
import { Store } from "@tanstack/store";
import { z } from "zod";

import { SyncConnection } from "./connection";
import { MailboxReplica } from "./replica";
import { WarmScheduler } from "./scheduler";
import { ReplicaStorage } from "./storage";
import type { SyncClientEvent, SyncClientOptions, SyncReceipt } from "./types";

export type {
  SyncApi,
  SyncClientEvent,
  SyncClientOptions,
  SyncReceipt,
} from "./types";

const peerSchema = z.discriminatedUnion("type", [
  z.object({
    mailboxIds: z.array(z.string()).max(32),
    ownerId: z.string(),
    type: z.literal("interest"),
  }),
  z.object({
    checkpoint: syncCheckpointSchema,
    entities: z.array(syncChangeSchema),
    mailboxId: z.string(),
    replace: z.boolean(),
    reset: z.boolean().optional(),
    type: z.literal("entities"),
  }),
  z.object({ type: z.literal("logout") }),
  z.object({ type: z.literal("mailboxes-changed") }),
  z.object({ type: z.literal("cache-cleared") }),
  z.object({ persistent: z.boolean(), type: z.literal("persistence-changed") }),
  z.object({ mailboxId: z.string(), type: z.literal("revoked") }),
]);
type Status = Extract<SyncClientEvent, { type: "status" }>;

export class MailSyncEngine {
  readonly status: Store<Status>;
  private readonly options: SyncClientOptions;
  private readonly controller = new AbortController();
  private readonly replicas = new Map<string, MailboxReplica>();
  private readonly mailboxControllers = new Map<string, AbortController>();
  private readonly loading = new Map<string, Promise<MailboxReplica>>();
  private readonly bodyCache = new Map<string, SyncBody>();
  private readonly localInterests = new Set<string>();
  private readonly peerInterests = new Map<
    string,
    { mailboxIds: string[]; seenAt: number }
  >();
  private readonly ownerId = crypto.randomUUID();
  private readonly scheduler: WarmScheduler;
  private readonly connection: SyncConnection;
  private readonly pinned = new Map<string, string[]>();
  private readonly commands = new Map<string, SyncCommand>();
  private readonly submitting = new Map<string, Promise<SyncReceipt>>();
  private storage: ReplicaStorage | null = null;
  private channel: BroadcastChannel | null = null;
  private leader = false;
  private online = true;
  private enabled = true;
  private maintenance: ReturnType<typeof setInterval> | null = null;
  private maintaining = false;
  private renewing = false;
  private lastEviction = 0;
  private clearing = false;
  private readonly revoked = new Set<string>();

  private constructor(options: SyncClientOptions) {
    this.options = options;
    this.status = new Store<Status>({
      budgetBytes: (options.mobile === true ? 75 : 200) * 1024 * 1024,
      cacheBytes: 0,
      connection: "connecting",
      persistent: false,
      type: "status",
    });
    this.scheduler = new WarmScheduler((error) => {
      this.notify({ error, operation: "mail_cache_warm", type: "error" });
    });
    this.connection = new SyncConnection({
      api: options.api,
      createSocket: options.createSocket ?? ((url) => new WebSocket(url)),
      onError: (error) => {
        this.notify({
          error,
          operation: "mail_sync_connection",
          type: "error",
        });
      },
      onMailboxesChanged: () => {
        this.notify({ type: "mailboxes-changed" });
        this.channel?.postMessage({ type: "mailboxes-changed" });
      },
      onRevoke: async (mailboxId) => {
        await this.revoke(mailboxId);
      },
      onStatus: (connection) => {
        if (connection === "disabled") {
          this.enabled = false;
        }
        this.status.setState((state) => ({ ...state, connection }));
        this.notify(this.status.state);
      },
      replicas: this.replicas,
      signal: this.controller.signal,
    });
  }

  static async create(options: SyncClientOptions) {
    const engine = new MailSyncEngine(options);
    try {
      if (options.persistent !== false) {
        engine.storage = await ReplicaStorage.open(options.userId);
      }
      const savedBudget = await engine.storage?.cacheBudget();
      let budget = savedBudget ?? engine.status.state.budgetBytes;
      if (
        typeof navigator !== "undefined" &&
        navigator.storage?.estimate !== undefined
      ) {
        const estimate = await navigator.storage.estimate();
        if (estimate.quota !== undefined) {
          budget = Math.max(
            10 * 1024 * 1024,
            Math.min(
              budget,
              Math.floor((estimate.quota - (estimate.usage ?? 0)) * 0.15)
            )
          );
        }
      }
      engine.status.setState((state) => ({
        ...state,
        budgetBytes: budget,
        persistent: engine.storage !== null,
      }));
    } catch (error) {
      engine.storage?.close();
      engine.storage = null;
      engine.notify({
        error,
        operation: "mail_cache_unavailable",
        type: "error",
      });
    }
    if (typeof BroadcastChannel !== "undefined") {
      engine.channel = new BroadcastChannel(
        `quieter-mail-v1:${options.userId}`
      );
      engine.channel.addEventListener(
        "message",
        (event: MessageEvent<unknown>) => {
          void engine.receivePeer(event.data);
        }
      );
    }
    engine.maintenance = setInterval(() => {
      void engine.tick();
    }, 5000);
    await engine.tick();
    return engine;
  }

  private notify(event: SyncClientEvent) {
    if (this.controller.signal.aborted) {
      return;
    }
    if (
      event.type === "error" &&
      event.error instanceof DOMException &&
      event.error.name === "QuotaExceededError" &&
      this.storage !== null &&
      !this.clearing
    ) {
      void this.recoverStoragePressure();
    }
    if (
      event.type === "error" &&
      event.error instanceof Error &&
      event.error.name === "SyncCacheResetError" &&
      !this.clearing
    ) {
      void this.recoverClearedCache();
      return;
    }
    this.options.onEvent(event);
    if (event.type !== "entities") {
      return;
    }
    const replica = this.replicas.get(event.mailboxId);
    if (this.leader && replica?.checkpoint !== null && replica !== undefined) {
      this.channel?.postMessage({ ...event, checkpoint: replica.checkpoint });
    }
    for (const entity of event.entities) {
      if (entity.data?.kind === "command") {
        const { command, status, error } = entity.data.value;
        const receipt = { commandId: command.commandId, error, status };
        this.options.onEvent({
          mailboxId: event.mailboxId,
          receipt,
          type: "receipt",
        });
        if (status === "applied" || status === "failed") {
          void this.finishCommand(command, receipt);
        }
      }
    }
    if (this.options.reducedData === true) {
      return;
    }
    const recent = event.entities
      .filter(
        (entity) =>
          entity.data?.kind === "thread" &&
          Number(entity.data.value.latest.internalDate ?? 0) >
            Date.now() - 14 * 86_400_000
      )
      .slice(0, 30);
    this.warmThreads(
      event.mailboxId,
      recent.map((entity) => entity.id),
      3
    );
  }

  private async ensureMailbox(mailboxId: string) {
    this.controller.signal.throwIfAborted();
    if (this.clearing || this.revoked.has(mailboxId)) {
      throw new DOMException("The mailbox cache is unavailable.", "AbortError");
    }
    const current = this.loading.get(mailboxId);
    if (current !== undefined) {
      return await current;
    }
    const existing = this.replicas.get(mailboxId);
    if (existing !== undefined) {
      return existing;
    }
    const pending = (async () => {
      const controller = new AbortController();
      this.mailboxControllers.set(mailboxId, controller);
      const replica = new MailboxReplica({
        api: this.options.api,
        bodyCache: this.bodyCache,
        mailboxId,
        notify: (event) => {
          this.notify(event);
        },
        signal: AbortSignal.any([this.controller.signal, controller.signal]),
        storage: this.storage,
      });
      this.replicas.set(mailboxId, replica);
      try {
        await replica.load();
      } catch (error) {
        if (this.replicas.get(mailboxId) === replica) {
          this.replicas.delete(mailboxId);
          controller.abort();
        }
        throw error;
      }
      if (this.leader) {
        this.connection.resume(replica);
      }
      return replica;
    })();
    this.loading.set(mailboxId, pending);
    try {
      return await pending;
    } finally {
      if (this.loading.get(mailboxId) === pending) {
        this.loading.delete(mailboxId);
      }
    }
  }

  async subscribe(mailboxIds: string[]) {
    this.localInterests.clear();
    for (const mailboxId of mailboxIds.slice(0, 32)) {
      this.revoked.delete(mailboxId);
      this.localInterests.add(mailboxId);
      await this.ensureMailbox(mailboxId);
    }
    this.channel?.postMessage({
      mailboxIds: [...this.localInterests],
      ownerId: this.ownerId,
      type: "interest",
    });
    await this.tick();
  }

  setVisible(visible: boolean) {
    this.scheduler.setVisible(visible);
    if (visible) {
      void this.tick();
    }
  }
  setOnline(online: boolean) {
    this.online = online;
    if (online) {
      void this.tick();
    } else {
      this.connection.stop();
    }
  }

  warmThreads(mailboxId: string, threadIds: string[], priority = 1) {
    if (
      !this.online ||
      !this.enabled ||
      this.clearing ||
      this.revoked.has(mailboxId) ||
      this.controller.signal.aborted ||
      (this.options.reducedData === true && priority > 0)
    ) {
      return;
    }
    for (const threadId of threadIds.slice(0, 60)) {
      this.scheduler.enqueue({
        key: `${mailboxId}:${threadId}`,
        priority,
        run: async () => {
          if (
            !this.localInterests.has(mailboxId) &&
            ![...this.peerInterests.values()].some((peer) =>
              peer.mailboxIds.includes(mailboxId)
            )
          ) {
            return;
          }
          const replica = await this.ensureMailbox(mailboxId);
          await replica.thread(threadId);
        },
      });
    }
  }

  pinThreads(mailboxId: string, threadIds: string[]) {
    this.pinned.set(mailboxId, threadIds);
    this.warmThreads(mailboxId, threadIds, 0);
  }

  async thread(
    mailboxId: string,
    threadId: string
  ): Promise<ThreadMessagesResult> {
    const replica = await this.ensureMailbox(mailboxId);
    return await replica.thread(threadId);
  }

  async command(input: SyncCommand) {
    if (!this.online) {
      throw new Error("Connect to the internet to make changes.");
    }
    const command = syncCommandSchema.parse(input);
    await this.storage?.journal(command);
    this.controller.signal.throwIfAborted();
    this.commands.set(`${command.mailboxId}:${command.commandId}`, command);
    try {
      return await this.submitCommand(command, false);
    } catch (error) {
      const failure = z
        .object({ code: z.string(), message: z.string() })
        .safeParse(error);
      if (
        failure.success &&
        [
          "BAD_REQUEST",
          "FORBIDDEN",
          "UNAUTHORIZED",
          "NOT_FOUND",
          "CONFLICT",
        ].includes(failure.data.code)
      ) {
        await this.finishCommand(command, {
          commandId: command.commandId,
          error: failure.data.message,
          status: "failed",
        });
        throw error;
      }
      this.notify({
        error,
        operation: "mail_command_interrupted",
        type: "error",
      });
      return {
        commandId: command.commandId,
        error: null,
        status: "accepted" as const,
      };
    }
  }

  private async submitCommand(
    command: SyncCommand,
    checkExisting = true
  ): Promise<SyncReceipt> {
    const key = `${command.mailboxId}:${command.commandId}`;
    const existing = this.submitting.get(key);
    if (existing !== undefined) {
      return await existing;
    }
    const pending = (async () => {
      const known = checkExisting
        ? await this.options.api.command(
            command.mailboxId,
            command.commandId,
            this.controller.signal
          )
        : null;
      const receipt =
        known ??
        (await this.options.api.submit(command, this.controller.signal));
      this.controller.signal.throwIfAborted();
      if (receipt.status === "applied") {
        const replica = await this.ensureMailbox(command.mailboxId);
        await replica.catchUp();
      }
      this.notify({ mailboxId: command.mailboxId, receipt, type: "receipt" });
      if (receipt.status === "applied" || receipt.status === "failed") {
        await this.finishCommand(command, receipt);
      }
      return receipt;
    })();
    this.submitting.set(key, pending);
    try {
      return await pending;
    } catch (error) {
      const failure = z
        .object({
          code: z.enum([
            "BAD_REQUEST",
            "FORBIDDEN",
            "UNAUTHORIZED",
            "NOT_FOUND",
            "CONFLICT",
          ]),
          message: z.string(),
        })
        .safeParse(error);
      if (failure.success) {
        const receipt: SyncReceipt = {
          commandId: command.commandId,
          error: failure.data.message,
          status: "failed",
        };
        await this.finishCommand(command, receipt);
        this.notify({ mailboxId: command.mailboxId, receipt, type: "receipt" });
      }
      throw error;
    } finally {
      this.submitting.delete(key);
    }
  }

  private async finishCommand(command: SyncCommand, _receipt: SyncReceipt) {
    try {
      await this.storage?.removeCommand(command.mailboxId, command.commandId);
      this.commands.delete(`${command.mailboxId}:${command.commandId}`);
    } catch (error) {
      this.notify({ error, operation: "mail_command_cleanup", type: "error" });
    }
  }

  private async tick() {
    if (
      !this.renewing &&
      !this.clearing &&
      !this.controller.signal.aborted &&
      this.enabled
    ) {
      this.renewing = true;
      try {
        this.leader =
          this.online &&
          (this.storage === null ||
            (await this.storage.claimLeadership(this.ownerId)));
        if (this.leader) {
          this.connection.start();
        } else {
          this.connection.stop();
        }
      } catch (error) {
        this.leader = false;
        this.connection.stop();
        this.notify({
          error,
          operation: "mail_sync_leadership",
          type: "error",
        });
      } finally {
        this.renewing = false;
      }
    }
    if (
      this.maintaining ||
      this.clearing ||
      this.controller.signal.aborted ||
      !this.enabled
    ) {
      return;
    }
    this.maintaining = true;
    try {
      const { leader } = this;
      this.controller.signal.throwIfAborted();
      this.channel?.postMessage({
        mailboxIds: [...this.localInterests],
        ownerId: this.ownerId,
        type: "interest",
      });
      const interests = new Set(this.localInterests);
      for (const [ownerId, peer] of this.peerInterests) {
        if (Date.now() - peer.seenAt > 30_000) {
          this.peerInterests.delete(ownerId);
        } else if (leader) {
          for (const mailboxId of peer.mailboxIds) {
            if (!this.revoked.has(mailboxId)) {
              interests.add(mailboxId);
            }
          }
        }
      }
      for (const mailboxId of interests) {
        await this.ensureMailbox(mailboxId);
      }
      for (const [mailboxId, replica] of this.replicas) {
        if (!interests.has(mailboxId)) {
          this.connection.unsubscribe(replica);
          this.mailboxControllers.get(mailboxId)?.abort();
          this.scheduler.cancel(mailboxId);
          this.replicas.delete(mailboxId);
        }
      }
      if (leader && this.online) {
        for (const mailboxId of interests) {
          const pending =
            this.storage === null
              ? [...this.commands.values()].filter(
                  (command) => command.mailboxId === mailboxId
                )
              : await this.storage.pendingCommands(mailboxId);
          for (const command of pending) {
            if (
              !this.leader ||
              this.clearing ||
              this.controller.signal.aborted
            ) {
              break;
            }
            await this.submitCommand(command);
          }
        }
      }
      if (Date.now() - this.lastEviction > 30_000) {
        await this.trim();
        this.lastEviction = Date.now();
      }
    } catch (error) {
      this.notify({ error, operation: "mail_sync_maintenance", type: "error" });
    } finally {
      this.maintaining = false;
    }
  }

  private async trim() {
    const pins = new Set<string>();
    for (const [mailboxId, threadIds] of this.pinned) {
      const replica = this.replicas.get(mailboxId);
      if (replica === undefined) {
        continue;
      }
      for (const entity of replica.entities.values()) {
        if (
          entity.data?.kind === "message" &&
          threadIds.includes(entity.data.value.threadId) &&
          entity.data.value.body !== null
        ) {
          pins.add(`${mailboxId}:${entity.data.value.body.hash}`);
        }
      }
    }
    let bytes = [...this.bodyCache.values()].reduce(
      (sum, body) =>
        sum + ((body.bodyHtml?.length ?? 0) + (body.bodyText?.length ?? 0)) * 2,
      0
    );
    for (const [key, body] of this.bodyCache) {
      if (bytes <= 32 * 1024 * 1024) {
        break;
      }
      if (pins.has(key)) {
        continue;
      }
      this.bodyCache.delete(key);
      bytes -=
        ((body.bodyHtml?.length ?? 0) + (body.bodyText?.length ?? 0)) * 2;
    }
    if (this.storage !== null) {
      const usage = await this.storage.enforceBudget(
        this.status.state.budgetBytes,
        pins
      );
      this.status.setState((state) => ({ ...state, cacheBytes: usage.used }));
      for (const replica of this.replicas.values()) {
        if (
          usage.evictedThreads.some((key) =>
            key.startsWith(`${replica.mailboxId}:`)
          )
        ) {
          await replica.load();
        }
      }
    }
    this.notify(this.status.state);
  }

  async setBudget(bytes: number) {
    const budget = Math.max(
      25 * 1024 * 1024,
      Math.min(250 * 1024 * 1024, bytes)
    );
    await this.storage?.cacheBudget(budget);
    this.status.setState((state) => ({ ...state, budgetBytes: budget }));
    await this.trim();
  }

  private async receivePeer(raw: unknown) {
    try {
      const parsed = peerSchema.safeParse(raw);
      if (!parsed.success || this.controller.signal.aborted) {
        return;
      }
      const message = parsed.data;
      if (message.type === "logout") {
        this.notify({ type: "session-ended" });
        await this.stop(true, false);
        return;
      }
      if (message.type === "mailboxes-changed") {
        this.notify({ type: "mailboxes-changed" });
        return;
      }
      if (message.type === "cache-cleared") {
        await this.clearCache(false);
        return;
      }
      if (message.type === "persistence-changed") {
        await this.setPersistence(message.persistent, false);
        return;
      }
      if (message.type === "revoked") {
        await this.revoke(message.mailboxId, false);
        return;
      }
      if (message.type === "interest") {
        this.peerInterests.set(message.ownerId, {
          mailboxIds: message.mailboxIds,
          seenAt: Date.now(),
        });
        return;
      }
      const replica = this.replicas.get(message.mailboxId);
      if (!this.leader && replica !== undefined) {
        await replica.acceptPeer(
          message.checkpoint,
          message.entities,
          message.replace,
          message.reset
        );
      }
    } catch (error) {
      this.notify({ error, operation: "mail_sync_peer", type: "error" });
    }
  }

  async revoke(mailboxId: string, broadcast = true) {
    this.revoked.add(mailboxId);
    this.scheduler.cancel(mailboxId);
    const replica = this.replicas.get(mailboxId);
    if (replica !== undefined) {
      this.connection.unsubscribe(replica);
    }
    this.mailboxControllers.get(mailboxId)?.abort();
    this.replicas.delete(mailboxId);
    this.localInterests.delete(mailboxId);
    for (const peer of this.peerInterests.values()) {
      peer.mailboxIds = peer.mailboxIds.filter((id) => id !== mailboxId);
    }
    for (const key of this.bodyCache.keys()) {
      if (key.startsWith(`${mailboxId}:`)) {
        this.bodyCache.delete(key);
      }
    }
    await this.storage?.purge(mailboxId);
    this.notify({ mailboxId, type: "revoked" });
    if (broadcast) {
      this.channel?.postMessage({ mailboxId, type: "revoked" });
    }
  }

  async stop(purge = false, broadcast = true) {
    if (this.controller.signal.aborted) {
      return;
    }
    this.controller.abort();
    this.connection.stop();
    this.scheduler.stop();
    if (this.maintenance !== null) {
      clearInterval(this.maintenance);
    }
    if (purge && broadcast) {
      this.channel?.postMessage({ type: "logout" });
    }
    this.channel?.close();
    this.bodyCache.clear();
    this.replicas.clear();
    if (purge) {
      await this.storage?.shutdownAndPurge();
    } else {
      this.storage?.close();
    }
  }

  private async recoverStoragePressure() {
    try {
      await this.setPersistence(false);
    } catch (error) {
      this.options.onEvent({
        error,
        operation: "mail_cache_recovery",
        type: "error",
      });
    }
  }

  private async recoverClearedCache() {
    try {
      await this.clearCache(false);
    } catch (error) {
      this.options.onEvent({
        error,
        operation: "mail_cache_reset",
        type: "error",
      });
    }
  }

  async setPersistence(persistent: boolean, broadcast = true) {
    if (
      (this.storage !== null) === persistent ||
      this.controller.signal.aborted
    ) {
      return;
    }
    if (this.clearing) {
      throw new Error("The cache is being updated. Please try again.");
    }
    await this.resetCache(async () => {
      if (persistent) {
        this.storage = await ReplicaStorage.open(this.options.userId);
        for (const command of this.commands.values()) {
          await this.storage.journal(command);
        }
      } else {
        const { storage } = this;
        if (storage !== null) {
          for (const command of await storage.pendingCommands()) {
            this.commands.set(
              `${command.mailboxId}:${command.commandId}`,
              command
            );
          }
          try {
            await storage.shutdownAndPurge();
          } finally {
            this.storage = null;
          }
        }
      }
      this.status.setState((state) => ({
        ...state,
        cacheBytes: 0,
        persistent,
      }));
      this.notify(this.status.state);
      if (broadcast) {
        this.channel?.postMessage({ persistent, type: "persistence-changed" });
      }
    });
  }

  async clearCache(broadcast = true) {
    await this.resetCache(async () => {
      if (broadcast) {
        await this.storage?.clearCache();
        this.channel?.postMessage({ type: "cache-cleared" });
      } else {
        await this.storage?.refreshGeneration();
      }
    });
  }

  private async resetCache(reset: () => Promise<void>) {
    if (this.clearing || this.controller.signal.aborted) {
      return;
    }
    this.clearing = true;
    this.connection.stop();
    this.scheduler.cancel();
    for (const controller of this.mailboxControllers.values()) {
      controller.abort();
    }
    this.replicas.clear();
    this.loading.clear();
    this.bodyCache.clear();
    try {
      await reset();
      this.notify({ type: "cache-cleared" });
    } finally {
      this.clearing = false;
    }
    await this.tick();
  }
}
