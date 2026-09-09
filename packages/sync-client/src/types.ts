import type { ThreadMessagesResult } from "@quieter/mail/messages";
import type {
  SyncBatch,
  SyncBody,
  SyncChange,
  SyncCheckpoint,
  SyncCommand,
  SyncSnapshot,
} from "@quieter/sync";

export type SyncReceipt = {
  commandId: string;
  status: "accepted" | "running" | "applied" | "failed";
  error: string | null;
};
export type SyncReplayPage = {
  reset: boolean;
  checkpoint: SyncCheckpoint;
  batches: SyncBatch[];
  hasMore: boolean;
};
export type SyncApi = {
  connection: (signal: AbortSignal) => Promise<{ url: string | null }>;
  snapshot: (
    mailboxId: string,
    signal: AbortSignal
  ) => Promise<SyncSnapshot | null>;
  replay: (
    mailboxId: string,
    checkpoint: SyncCheckpoint,
    signal: AbortSignal
  ) => Promise<SyncReplayPage>;
  hydrate: (
    mailboxId: string,
    threadIds: string[],
    signal: AbortSignal
  ) => Promise<SyncSnapshot | null>;
  body: (
    mailboxId: string,
    messageId: string,
    hash: string,
    signal: AbortSignal
  ) => Promise<SyncBody>;
  submit: (command: SyncCommand, signal: AbortSignal) => Promise<SyncReceipt>;
  command: (
    mailboxId: string,
    commandId: string,
    signal: AbortSignal
  ) => Promise<SyncReceipt | null>;
};

export type SyncClientEvent =
  | { type: "cache-cleared" }
  | {
      type: "entities";
      mailboxId: string;
      entities: SyncChange[];
      replace: boolean;
    }
  | { type: "thread"; mailboxId: string; thread: ThreadMessagesResult }
  | { type: "revoked"; mailboxId: string }
  | { type: "receipt"; mailboxId: string; receipt: SyncReceipt }
  | {
      type: "status";
      connection:
        | "connecting"
        | "live"
        | "reconnecting"
        | "fallback"
        | "disabled";
      persistent: boolean;
      cacheBytes: number;
      budgetBytes: number;
    }
  | { type: "error"; operation: string; error: unknown };

export type SyncClientOptions = {
  userId: string;
  api: SyncApi;
  onEvent: (event: SyncClientEvent) => void;
  mobile?: boolean;
  reducedData?: boolean;
  createSocket?: (url: string) => WebSocket;
};
