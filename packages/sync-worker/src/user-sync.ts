import {
  authorizeSyncMailbox,
  authorizeSyncSession,
  mailSyncServices,
} from "@quieter/orpc/mail-sync";
import {
  SYNC_MAX_MAILBOXES,
  encodeSyncBatch,
  syncClientFrameSchema,
  visibleSyncChanges,
} from "@quieter/sync";
import type { SyncBatch, SyncServerFrame } from "@quieter/sync";
import { verifySyncTicket } from "@quieter/sync-server/auth";
import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

import { withSyncRuntime } from "./runtime";

const attachmentSchema = z.object({
  createdAt: z.number(),
  id: z.uuid(),
  sessionId: z.string(),
  userId: z.string(),
});
type Subscription = {
  socketId: string;
  mailboxId: string;
  generation: string;
  checkedAt: number;
  epoch: string;
  sent: string;
};

export class UserSync extends DurableObject<SyncEnv> {
  constructor(ctx: DurableObjectState, env: SyncEnv) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('{"type":"PING"}', '{"type":"PONG"}')
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS subscriptions (socketId TEXT NOT NULL, mailboxId TEXT NOT NULL, generation TEXT NOT NULL, checkedAt INTEGER NOT NULL, epoch TEXT NOT NULL, sent TEXT NOT NULL, PRIMARY KEY(socketId, mailboxId))"
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS outstanding (socketId TEXT NOT NULL, mailboxId TEXT NOT NULL, sequence TEXT NOT NULL, bytes INTEGER NOT NULL, PRIMARY KEY(socketId, mailboxId, sequence))"
    );
    void ctx.blockConcurrencyWhile(async () => {
      if (
        ctx
          .getWebSockets()
          .some((socket) => socket.readyState === WebSocket.OPEN) &&
        (await ctx.storage.getAlarm()) === null
      ) {
        await ctx.storage.setAlarm(Date.now() + 120_000);
      }
    });
  }

  async fetch(request: Request) {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response(null, { status: 426 });
    }
    const secret = z
      .object({ value: z.string() })
      .parse(JSON.parse(this.env.SST_RESOURCE_MailSyncSecret)).value;
    const claims = verifySyncTicket(
      new URL(request.url).searchParams.get("ticket") ?? "",
      secret
    );
    try {
      await withSyncRuntime(this.env, async () => {
        await authorizeSyncSession(claims.sessionId, claims.userId);
      });
    } catch (error) {
      const parsed = z
        .object({ code: z.literal("UNAUTHORIZED") })
        .safeParse(error);
      if (parsed.success) {
        return new Response(null, { status: 401 });
      }
      throw error;
    }
    const sockets = this.ctx.getWebSockets();
    if (sockets.length >= 6) {
      sockets[0].close(1008, "Connection limit reached");
    }
    const [client, server] = Object.values(new WebSocketPair());
    server.serializeAttachment({
      createdAt: Date.now(),
      id: crypto.randomUUID(),
      sessionId: claims.sessionId,
      userId: claims.userId,
    });
    this.ctx.acceptWebSocket(server);
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + 120_000);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string" || message.length > 4096) {
      socket.close(1009, "Invalid message");
      return;
    }
    const attachment = attachmentSchema.parse(socket.deserializeAttachment());
    if (Date.now() - attachment.createdAt > 15 * 60_000) {
      socket.close(1000, "Reconnect required");
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(message);
    } catch {
      socket.close(1008, "Invalid message");
      return;
    }
    const parsed = syncClientFrameSchema.safeParse(raw);
    if (!parsed.success) {
      socket.close(1008, "Invalid message");
      return;
    }
    const frame = parsed.data;
    if (frame.type === "PING") {
      socket.send(JSON.stringify({ type: "PONG" } satisfies SyncServerFrame));
      return;
    }
    const [subscription] = this.ctx.storage.sql
      .exec<Subscription>(
        "SELECT * FROM subscriptions WHERE socketId=? AND mailboxId=?",
        attachment.id,
        frame.mailboxId
      )
      .toArray();
    if (frame.type === "UNSUBSCRIBE") {
      if (subscription?.generation === frame.generation) {
        await this.removeSubscription(
          attachment.id,
          attachment.userId,
          frame.mailboxId
        );
      }
      return;
    }
    if (frame.type === "ACK") {
      if (
        subscription?.generation !== frame.generation ||
        subscription.epoch !== frame.checkpoint.epoch ||
        BigInt(frame.checkpoint.sequence) > BigInt(subscription.sent)
      ) {
        return;
      }
      this.ctx.storage.sql.exec(
        "DELETE FROM outstanding WHERE socketId=? AND mailboxId=? AND sequence<=?",
        attachment.id,
        frame.mailboxId,
        frame.checkpoint.sequence.padStart(19, "0")
      );
      return;
    }
    const { count } = this.ctx.storage.sql
      .exec<{ count: number }>(
        "SELECT count(*) AS count FROM subscriptions WHERE socketId=?",
        attachment.id
      )
      .one();
    if (subscription === undefined && count >= SYNC_MAX_MAILBOXES) {
      socket.close(1008, "Subscription limit reached");
      return;
    }
    const allowed = await this.checkAccess(
      socket,
      frame.mailboxId,
      frame.generation
    );
    if (!allowed || !this.ctx.getWebSockets().includes(socket)) {
      return;
    }
    this.ctx.storage.sql.exec(
      "DELETE FROM outstanding WHERE socketId=? AND mailboxId=?",
      attachment.id,
      frame.mailboxId
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO subscriptions VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(socketId,mailboxId) DO UPDATE SET generation=excluded.generation, checkedAt=excluded.checkedAt, epoch=excluded.epoch, sent=excluded.sent",
      attachment.id,
      frame.mailboxId,
      frame.generation,
      Date.now(),
      frame.checkpoint?.epoch ?? "",
      frame.checkpoint?.sequence ?? "0"
    );
    await this.env.MailboxSyncObjects.getByName(frame.mailboxId).subscribe(
      attachment.userId
    );
    const head = await withSyncRuntime(
      this.env,
      async () => await mailSyncServices().repository.head(frame.mailboxId)
    );
    const [current] = this.ctx.storage.sql
      .exec<Subscription>(
        "SELECT * FROM subscriptions WHERE socketId=? AND mailboxId=?",
        attachment.id,
        frame.mailboxId
      )
      .toArray();
    if (current?.generation !== frame.generation) {
      return;
    }
    if (
      head === null ||
      frame.checkpoint === null ||
      head.epoch !== frame.checkpoint.epoch
    ) {
      socket.send(
        JSON.stringify({
          generation: frame.generation,
          mailboxId: frame.mailboxId,
          type: "RESET_REQUIRED",
        } satisfies SyncServerFrame)
      );
    } else {
      this.ctx.storage.sql.exec(
        "UPDATE subscriptions SET epoch=?, sent=? WHERE socketId=? AND mailboxId=?",
        head.epoch,
        head.sequence,
        attachment.id,
        frame.mailboxId
      );
      socket.send(
        JSON.stringify({
          checkpoint: head,
          generation: frame.generation,
          mailboxId: frame.mailboxId,
          type: "HEAD",
        } satisfies SyncServerFrame)
      );
    }
  }

  private async checkAccess(
    socket: WebSocket,
    mailboxId: string,
    generation: string,
    sessions?: Map<string, Promise<void>>
  ) {
    const attachment = attachmentSchema.parse(socket.deserializeAttachment());
    try {
      await withSyncRuntime(this.env, async () => {
        let authorized = sessions?.get(attachment.sessionId);
        if (authorized === undefined) {
          authorized = authorizeSyncSession(
            attachment.sessionId,
            attachment.userId
          );
          sessions?.set(attachment.sessionId, authorized);
        }
        await authorized;
        await authorizeSyncMailbox(mailboxId, attachment.userId);
      });
      return true;
    } catch (error) {
      const code = z.object({ code: z.string() }).safeParse(error);
      if (
        code.success &&
        ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(code.data.code)
      ) {
        await this.removeSubscription(
          attachment.id,
          attachment.userId,
          mailboxId
        );
        socket.send(
          JSON.stringify({
            generation,
            mailboxId,
            type: "REVOKED",
          } satisfies SyncServerFrame)
        );
        return false;
      }
      socket.close(1011, "Connection temporarily unavailable");
      throw error;
    }
  }

  private async refreshSubscriptions(
    socket: WebSocket,
    sessions = new Map<string, Promise<void>>()
  ) {
    const attachment = attachmentSchema.parse(socket.deserializeAttachment());
    const subscriptions = this.ctx.storage.sql
      .exec<Subscription>(
        "SELECT * FROM subscriptions WHERE socketId=?",
        attachment.id
      )
      .toArray();
    for (const subscription of subscriptions) {
      if (
        await this.checkAccess(
          socket,
          subscription.mailboxId,
          subscription.generation,
          sessions
        )
      ) {
        this.ctx.storage.sql.exec(
          "UPDATE subscriptions SET checkedAt=? WHERE socketId=? AND mailboxId=? AND generation=?",
          Date.now(),
          attachment.id,
          subscription.mailboxId,
          subscription.generation
        );
        const expired = await this.env.MailboxSyncObjects.getByName(
          subscription.mailboxId
        ).subscribe(attachment.userId);
        if (expired) {
          const head = await withSyncRuntime(
            this.env,
            async () =>
              await mailSyncServices().repository.head(subscription.mailboxId)
          );
          if (head !== null && socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                checkpoint: head,
                generation: subscription.generation,
                mailboxId: subscription.mailboxId,
                type: "HEAD",
              } satisfies SyncServerFrame)
            );
          }
        }
      }
    }
  }

  async alarm() {
    try {
      const sessions = new Map<string, Promise<void>>();
      const results = await Promise.allSettled(
        this.ctx.getWebSockets().map(async (socket) => {
          if (socket.readyState !== WebSocket.OPEN) {
            return;
          }
          const attachment = attachmentSchema.parse(
            socket.deserializeAttachment()
          );
          if (Date.now() - attachment.createdAt >= 15 * 60_000) {
            socket.close(1000, "Reconnect required");
          } else {
            await this.refreshSubscriptions(socket, sessions);
          }
        })
      );
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") {
        throw failure.reason;
      }
    } finally {
      if (
        this.ctx
          .getWebSockets()
          .some((socket) => socket.readyState === WebSocket.OPEN)
      ) {
        await this.ctx.storage.setAlarm(Date.now() + 120_000);
      }
    }
  }

  async publish(batch: SyncBatch) {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = attachmentSchema.parse(socket.deserializeAttachment());
      if (Date.now() - attachment.createdAt >= 15 * 60_000) {
        socket.close(1000, "Reconnect required");
        continue;
      }
      const [subscription] = this.ctx.storage.sql
        .exec<Subscription>(
          "SELECT * FROM subscriptions WHERE socketId=? AND mailboxId=?",
          attachment.id,
          batch.mailboxId
        )
        .toArray();
      if (subscription === undefined) {
        continue;
      }
      if (Date.now() - subscription.checkedAt > 30_000) {
        if (
          !(await this.checkAccess(
            socket,
            batch.mailboxId,
            subscription.generation
          ))
        ) {
          continue;
        }
        this.ctx.storage.sql.exec(
          "UPDATE subscriptions SET checkedAt=? WHERE socketId=? AND mailboxId=? AND generation=?",
          Date.now(),
          attachment.id,
          batch.mailboxId,
          subscription.generation
        );
      }
      const [current] = this.ctx.storage.sql
        .exec<Subscription>(
          "SELECT * FROM subscriptions WHERE socketId=? AND mailboxId=?",
          attachment.id,
          batch.mailboxId
        )
        .toArray();
      if (current?.generation !== subscription.generation) {
        continue;
      }
      const frames = encodeSyncBatch(
        {
          ...batch,
          changes: visibleSyncChanges(batch.changes, attachment.userId),
        },
        subscription.generation
      );
      const bytes = frames.reduce(
        (sum, frame) => sum + new TextEncoder().encode(frame).byteLength,
        0
      );
      const pending = this.ctx.storage.sql
        .exec<{ bytes: number }>(
          "SELECT coalesce(sum(bytes),0) AS bytes FROM outstanding WHERE socketId=?",
          attachment.id
        )
        .one().bytes;
      const checkpoint = { epoch: batch.epoch, sequence: batch.sequence };
      if (
        current.epoch === batch.epoch &&
        BigInt(current.sent) >= BigInt(batch.sequence)
      ) {
        continue;
      }
      this.ctx.storage.sql.exec(
        "UPDATE subscriptions SET epoch=?, sent=? WHERE socketId=? AND mailboxId=?",
        batch.epoch,
        batch.sequence,
        attachment.id,
        batch.mailboxId
      );
      if (pending + bytes > 1_048_576) {
        socket.send(
          JSON.stringify({
            checkpoint,
            generation: subscription.generation,
            mailboxId: batch.mailboxId,
            type: "HEAD",
          } satisfies SyncServerFrame)
        );
        continue;
      }
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO outstanding VALUES (?, ?, ?, ?)",
        attachment.id,
        batch.mailboxId,
        batch.sequence.padStart(19, "0"),
        bytes
      );
      for (const frame of frames) {
        socket.send(frame);
      }
    }
  }

  async accessChanged() {
    for (const socket of this.ctx.getWebSockets()) {
      await this.refreshSubscriptions(socket);
      socket.send(
        JSON.stringify({ type: "MAILBOXES_CHANGED" } satisfies SyncServerFrame)
      );
    }
  }

  async revoke(mailboxId?: string) {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = attachmentSchema.parse(socket.deserializeAttachment());
      const subscriptions = this.ctx.storage.sql
        .exec<Subscription>(
          "SELECT * FROM subscriptions WHERE socketId=?",
          attachment.id
        )
        .toArray();
      for (const subscription of subscriptions) {
        if (mailboxId === undefined || subscription.mailboxId === mailboxId) {
          await this.removeSubscription(
            attachment.id,
            attachment.userId,
            subscription.mailboxId
          );
          socket.send(
            JSON.stringify({
              generation: subscription.generation,
              mailboxId: subscription.mailboxId,
              type: "REVOKED",
            } satisfies SyncServerFrame)
          );
        }
      }
      if (mailboxId === undefined) {
        socket.close(1000, "Session ended");
      }
    }
  }

  private async removeSubscription(
    socketId: string,
    userId: string,
    mailboxId: string
  ) {
    this.ctx.storage.sql.exec(
      "DELETE FROM subscriptions WHERE socketId=? AND mailboxId=?",
      socketId,
      mailboxId
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM outstanding WHERE socketId=? AND mailboxId=?",
      socketId,
      mailboxId
    );
    const { count } = this.ctx.storage.sql
      .exec<{ count: number }>(
        "SELECT count(*) AS count FROM subscriptions WHERE mailboxId=?",
        mailboxId
      )
      .one();
    if (count === 0) {
      await this.env.MailboxSyncObjects.getByName(mailboxId).unsubscribe(
        userId
      );
    }
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string) {
    const attachment = attachmentSchema.parse(socket.deserializeAttachment());
    const subscriptions = this.ctx.storage.sql
      .exec<Subscription>(
        "SELECT * FROM subscriptions WHERE socketId=?",
        attachment.id
      )
      .toArray();
    for (const subscription of subscriptions) {
      await this.removeSubscription(
        attachment.id,
        attachment.userId,
        subscription.mailboxId
      );
    }
    socket.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    if (
      !this.ctx
        .getWebSockets()
        .some((active) => active.readyState === WebSocket.OPEN)
    ) {
      await this.ctx.storage.deleteAlarm();
    }
  }

  async webSocketError(socket: WebSocket) {
    await this.webSocketClose(socket, 1011, "Connection interrupted");
  }
}
