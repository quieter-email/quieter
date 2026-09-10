import { createHash } from "node:crypto";

import type { MessageListItem } from "@quieter/mail/messages";
import { syncBodySchema, syncMessageSchema } from "@quieter/sync";
import type { SyncBody, SyncMessage } from "@quieter/sync";

export type SyncBodyStore = {
  has: (key: string) => Promise<boolean>;
  get: (key: string) => Promise<Uint8Array | null>;
  put: (key: string, body: Uint8Array) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

export const encodeSyncBody = (body: SyncBody) => {
  const payload = new TextEncoder().encode(
    JSON.stringify(syncBodySchema.parse(body))
  );
  return {
    bytes: payload.byteLength,
    hash: createHash("sha256").update(payload).digest("hex"),
    payload,
  };
};

export const prepareSyncMessage = async (
  store: SyncBodyStore,
  mailboxId: string,
  message: MessageListItem
): Promise<SyncMessage> => {
  const body = encodeSyncBody({
    bodyHtml: message.bodyHtml,
    bodyText: message.bodyText,
  });
  await store.put(
    `sync/bodies/${encodeURIComponent(mailboxId)}/${body.hash}`,
    body.payload
  );
  return syncMessageSchema.parse({
    ...message,
    attachments: message.attachments ?? [],
    body: { bytes: body.bytes, hash: body.hash },
    isUnread: message.isUnread ?? message.labelIds?.includes("UNREAD") ?? false,
    labelIds: message.labelIds ?? [],
  });
};

export const readSyncBody = async (
  store: SyncBodyStore,
  mailboxId: string,
  hash: string
): Promise<SyncBody | null> => {
  const bytes = await store.get(
    `sync/bodies/${encodeURIComponent(mailboxId)}/${hash}`
  );
  if (bytes === null) {
    return null;
  }
  if (createHash("sha256").update(bytes).digest("hex") !== hash) {
    throw new Error("Stored message content failed its integrity check.");
  }
  return syncBodySchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
};
