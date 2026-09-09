import type { SyncClientFrame } from "@quieter/sync";

import { SyncFrameAssembler } from "./frames";
import type { MailboxReplica } from "./replica";
import type { SyncApi } from "./types";

type ConnectionStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  | "fallback"
  | "disabled";
type ConnectionOptions = {
  api: SyncApi;
  signal: AbortSignal;
  replicas: ReadonlyMap<string, MailboxReplica>;
  createSocket: (url: string) => WebSocket;
  onStatus: (status: ConnectionStatus) => void;
  onError: (error: unknown) => void;
  onRevoke: (mailboxId: string) => Promise<void>;
};

export class SyncConnection {
  private readonly options: ConnectionOptions;
  private readonly assembler = new SyncFrameAssembler();
  private socket: WebSocket | null = null;
  private active = false;
  private connecting = false;
  private failures = 0;
  private lastActivity = 0;
  private lastPoll = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnect: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ConnectionOptions) {
    this.options = options;
  }

  start() {
    if (this.active || this.options.signal.aborted) {
      return;
    }
    this.active = true;
    this.heartbeat = setInterval(() => {
      void this.tick();
    }, 15_000);
    void this.connect();
  }

  stop() {
    this.active = false;
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
    }
    if (this.reconnect !== null) {
      clearTimeout(this.reconnect);
    }
    const { socket } = this;
    this.socket = null;
    socket?.close(1000, "Connection released");
    this.assembler.reset();
  }

  resume(replica: MailboxReplica) {
    this.send({
      checkpoint: replica.checkpoint,
      generation: replica.generation,
      mailboxId: replica.mailboxId,
      protocol: 1,
      type: "RESUME",
    });
  }

  unsubscribe(replica: MailboxReplica) {
    this.send({
      generation: replica.generation,
      mailboxId: replica.mailboxId,
      type: "UNSUBSCRIBE",
    });
  }

  private send(frame: SyncClientFrame) {
    if (this.socket?.readyState === 1 && this.active) {
      this.socket.send(JSON.stringify(frame));
    }
  }

  private async connect() {
    if (!this.active || this.connecting || this.options.signal.aborted) {
      return;
    }
    this.connecting = true;
    try {
      this.options.onStatus(
        this.failures === 0 ? "connecting" : "reconnecting"
      );
      const { url } = await this.options.api.connection(this.options.signal);
      if (!this.active || this.options.signal.aborted) {
        return;
      }
      if (url === null) {
        this.options.onStatus("disabled");
        this.stop();
        return;
      }
      const socket = this.options.createSocket(url);
      this.socket = socket;
      this.lastActivity = Date.now();
      socket.addEventListener("open", () => {
        if (this.socket !== socket || !this.active) {
          socket.close();
          return;
        }
        for (const replica of this.options.replicas.values()) {
          this.resume(replica);
        }
      });
      socket.addEventListener("message", (event: MessageEvent<unknown>) => {
        void this.receive(socket, event.data);
      });
      socket.addEventListener("close", () => {
        if (this.socket !== socket) {
          return;
        }
        this.socket = null;
        this.scheduleReconnect();
      });
      socket.addEventListener("error", () => {
        socket.close();
      });
    } catch (error) {
      if (!this.options.signal.aborted) {
        this.options.onError(error);
        this.scheduleReconnect();
      }
    } finally {
      this.connecting = false;
    }
  }

  private scheduleReconnect() {
    if (!this.active || this.options.signal.aborted) {
      return;
    }
    this.failures += 1;
    this.options.onStatus(this.failures >= 3 ? "fallback" : "reconnecting");
    if (this.reconnect !== null) {
      clearTimeout(this.reconnect);
    }
    const delay =
      Math.min(30_000, 500 * 2 ** Math.min(this.failures, 6)) *
      (0.75 + Math.random() * 0.5);
    this.reconnect = setTimeout(() => {
      this.reconnect = null;
      void this.connect();
    }, delay);
  }

  private async tick() {
    if (!this.active || this.options.signal.aborted) {
      return;
    }
    try {
      if (this.socket !== null && Date.now() - this.lastActivity > 45_000) {
        this.socket.close(1000, "Connection check expired");
      }
      this.send({ type: "PING" });
      if (this.failures >= 3 && Date.now() - this.lastPoll >= 30_000) {
        this.lastPoll = Date.now();
        for (const replica of this.options.replicas.values()) {
          await replica.catchUp();
        }
      }
    } catch (error) {
      if (!this.options.signal.aborted) {
        this.options.onError(error);
      }
    }
  }

  private async receive(socket: WebSocket, raw: unknown) {
    if (this.socket !== socket || !this.active || this.options.signal.aborted) {
      return;
    }
    try {
      if (typeof raw !== "string") {
        throw new TypeError("Unexpected sync frame encoding.");
      }
      const frame = this.assembler.accept(raw);
      this.lastActivity = Date.now();
      if (frame === null || frame.type === "PONG") {
        return;
      }
      const mailboxId =
        frame.type === "PATCH" ? frame.batch.mailboxId : frame.mailboxId;
      const replica = this.options.replicas.get(mailboxId);
      if (replica === undefined || replica.generation !== frame.generation) {
        return;
      }
      if (frame.type === "REVOKED") {
        await this.options.onRevoke(mailboxId);
        return;
      }
      if (frame.type === "RESET_REQUIRED") {
        await replica.reset();
        await replica.catchUp();
        this.resume(replica);
      } else if (frame.type === "HEAD") {
        if (
          replica.checkpoint?.epoch !== frame.checkpoint.epoch ||
          replica.checkpoint.sequence !== frame.checkpoint.sequence
        ) {
          await replica.catchUp();
          this.resume(replica);
        }
      } else {
        const action = await replica.apply(frame.batch, frame.generation);
        if (action === "reset" || action === "gap") {
          await replica.catchUp();
          this.resume(replica);
        }
      }
      if (this.socket !== socket || this.options.signal.aborted) {
        return;
      }
      this.failures = 0;
      this.options.onStatus("live");
      if (replica.checkpoint !== null) {
        this.send({
          checkpoint: replica.checkpoint,
          generation: replica.generation,
          mailboxId,
          type: "ACK",
        });
      }
    } catch (error) {
      if (!this.options.signal.aborted) {
        this.options.onError(error);
        socket.close(1011, "Synchronization interrupted");
      }
    }
  }
}
