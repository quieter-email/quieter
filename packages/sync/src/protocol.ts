import { composeDraftAnchorSchema } from "@quieter/mail/compose/schema";
import { mailboxSavedViewDefinitionSchema } from "@quieter/mail/mailbox-organization";
import { z } from "zod";

export const SYNC_PROTOCOL_VERSION = 1;
export const SYNC_FRAME_BYTES = 256 * 1024;
export const SYNC_REPLAY_BATCHES = 100;
export const SYNC_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export const syncIdSchema = z.string().min(1).max(256);
export const syncSequenceSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,18})$/u)
  .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n);
export const syncCheckpointSchema = z.object({
  epoch: z.uuid(),
  sequence: syncSequenceSchema,
});
export type SyncCheckpoint = z.infer<typeof syncCheckpointSchema>;

export const syncBodySchema = z.object({
  bodyHtml: z
    .string()
    .max(20 * 1024 * 1024)
    .optional(),
  bodyText: z
    .string()
    .max(20 * 1024 * 1024)
    .optional(),
});
export type SyncBody = z.infer<typeof syncBodySchema>;
export const syncBodyReferenceSchema = z.object({
  bytes: z.number().int().nonnegative(),
  hash: z.string().regex(/^[a-f0-9]{64}$/u),
});

export const syncMessageSchema = z.object({
  attachments: z.array(
    z.object({
      attachmentId: syncIdSchema,
      fileName: z.string(),
      mimeType: z.string(),
      size: z.number().nonnegative(),
    })
  ),
  bcc: z.string().optional(),
  body: syncBodyReferenceSchema.nullable(),
  cc: z.string().optional(),
  date: z.string().optional(),
  draftAnchor: composeDraftAnchorSchema.optional(),
  draftId: syncIdSchema.optional(),
  from: z.string().optional(),
  id: syncIdSchema,
  inReplyTo: z.string().optional(),
  internalDate: z.string().optional(),
  isUnread: z.boolean(),
  labelIds: z.array(z.string()),
  messageHeaderId: z.string().optional(),
  references: z.string().optional(),
  replyTo: z.string().optional(),
  senderAvatarUrls: z
    .object({ dark: z.string(), light: z.string() })
    .optional(),
  snippet: z.string().optional(),
  subject: z.string().optional(),
  threadId: syncIdSchema,
  to: z.string().optional(),
  unsubscribeMailto: z.string().optional(),
  unsubscribeUrl: z.string().optional(),
});
export type SyncMessage = z.infer<typeof syncMessageSchema>;

export const syncCommandSchema = z.object({
  command: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("set-read"), read: z.boolean() }),
    z.object({
      destination: z.enum(["archive", "inbox", "spam", "trash"]),
      kind: z.literal("move"),
    }),
    z.object({
      addIds: z.array(syncIdSchema).max(100),
      kind: z.literal("set-labels"),
      removeIds: z.array(syncIdSchema).max(100),
    }),
    z.object({ kind: z.literal("delete-permanently") }),
  ]),
  commandId: z.uuid(),
  mailboxId: syncIdSchema,
  targets: z
    .array(
      z.object({
        messageIds: z.array(syncIdSchema).min(1).max(100),
        threadId: syncIdSchema,
      })
    )
    .min(1)
    .max(100),
});
export type SyncCommand = z.infer<typeof syncCommandSchema>;

export const syncEntityDataSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("command"),
    value: z.object({
      command: syncCommandSchema,
      error: z.string().nullable(),
      status: z.enum(["accepted", "running", "applied", "failed"]),
      updatedAt: z.string(),
      userId: syncIdSchema,
    }),
  }),
  z.object({ kind: z.literal("message"), value: syncMessageSchema }),
  z.object({
    kind: z.literal("thread"),
    value: z.object({
      attachmentCount: z.number().int().nonnegative(),
      id: syncIdSchema,
      isUnread: z.boolean(),
      labelIds: z.array(z.string()),
      latest: syncMessageSchema,
      messageCount: z.number().int().nonnegative(),
      messageIds: z.array(syncIdSchema),
    }),
  }),
  z.object({
    kind: z.literal("label"),
    value: z.object({
      color: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      id: syncIdSchema,
      inclusionCriteria: z.string().nullable().optional(),
      name: z.string(),
      position: z.number().optional(),
      type: z.string().optional(),
      visible: z.boolean().optional(),
    }),
  }),
  z.object({
    kind: z.literal("overview"),
    value: z.object({
      counts: z.record(z.string(), z.number().int().nonnegative()),
      status: z.enum(["importing", "ready", "needs_reconnect"]),
    }),
  }),
  z.object({
    kind: z.literal("saved-view"),
    value: mailboxSavedViewDefinitionSchema.extend({
      createdAt: z.string(),
      disabledReason: z.string().nullable(),
      id: syncIdSchema,
      normalizedName: z.string(),
      ownerUserId: syncIdSchema.nullable(),
      position: z.number(),
      updatedAt: z.string(),
    }),
  }),
  z.object({
    kind: z.literal("delivery"),
    value: z.object({
      messageId: syncIdSchema,
      status: z.string(),
      updatedAt: z.string(),
    }),
  }),
]);
export type SyncEntityData = z.infer<typeof syncEntityDataSchema>;
export const syncEntityKindSchema = z.enum([
  "command",
  "message",
  "thread",
  "label",
  "overview",
  "saved-view",
  "delivery",
]);
export type SyncEntityKind = z.infer<typeof syncEntityKindSchema>;
export const syncChangeSchema = z
  .object({
    data: syncEntityDataSchema.nullable(),
    id: syncIdSchema,
    kind: syncEntityKindSchema,
    version: syncSequenceSchema,
  })
  .refine((value) => value.data === null || value.data.kind === value.kind);
export type SyncChange = z.infer<typeof syncChangeSchema>;

export const visibleSyncChanges = (changes: SyncChange[], userId: string) =>
  changes.filter(({ data }) => {
    if (data?.kind === "command") {
      return data.value.userId === userId;
    }
    if (data?.kind === "saved-view") {
      return (
        data.value.ownerUserId === null || data.value.ownerUserId === userId
      );
    }
    return true;
  });

export const syncBatchSchema = z
  .object({
    changes: z.array(syncChangeSchema).max(10_000),
    epoch: z.uuid(),
    mailboxId: syncIdSchema,
    protocol: z.literal(SYNC_PROTOCOL_VERSION),
    sequence: syncSequenceSchema,
  })
  .refine((batch) =>
    batch.changes.every((change) => change.version === batch.sequence)
  );
export type SyncBatch = z.infer<typeof syncBatchSchema>;

export const syncSnapshotSchema = z.object({
  checkpoint: syncCheckpointSchema,
  coverage: z.object({
    complete: z.boolean(),
    kind: z.enum(["working-set", "threads"]),
    threadIds: z.array(syncIdSchema),
  }),
  entities: z.array(syncChangeSchema),
  mailboxId: syncIdSchema,
});
export type SyncSnapshot = z.infer<typeof syncSnapshotSchema>;

export const syncClientFrameSchema = z.discriminatedUnion("type", [
  z.object({
    checkpoint: syncCheckpointSchema.nullable(),
    generation: z.uuid(),
    mailboxId: syncIdSchema,
    protocol: z.literal(1),
    type: z.literal("RESUME"),
  }),
  z.object({
    checkpoint: syncCheckpointSchema,
    generation: z.uuid(),
    mailboxId: syncIdSchema,
    type: z.literal("ACK"),
  }),
  z.object({
    generation: z.uuid(),
    mailboxId: syncIdSchema,
    type: z.literal("UNSUBSCRIBE"),
  }),
  z.object({ type: z.literal("PING") }),
]);
export type SyncClientFrame = z.infer<typeof syncClientFrameSchema>;
export const syncServerFrameSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("MAILBOXES_CHANGED") }),
  z.object({
    batch: syncBatchSchema,
    generation: z.uuid(),
    type: z.literal("PATCH"),
  }),
  z.object({
    checkpoint: syncCheckpointSchema,
    generation: z.uuid(),
    index: z.number().int().nonnegative(),
    mailboxId: syncIdSchema,
    payload: z.string().max(SYNC_FRAME_BYTES),
    total: z.number().int().min(1).max(256),
    type: z.literal("CHUNK"),
  }),
  z.object({
    generation: z.uuid(),
    mailboxId: syncIdSchema,
    type: z.literal("RESET_REQUIRED"),
  }),
  z.object({
    generation: z.uuid(),
    mailboxId: syncIdSchema,
    type: z.literal("REVOKED"),
  }),
  z.object({
    checkpoint: syncCheckpointSchema,
    generation: z.uuid(),
    mailboxId: syncIdSchema,
    type: z.literal("HEAD"),
  }),
  z.object({ type: z.literal("PONG") }),
]);
export type SyncServerFrame = z.infer<typeof syncServerFrameSchema>;

export const encodeSyncBatch = (
  batch: SyncBatch,
  generation: string
): string[] => {
  const frame = JSON.stringify({
    batch,
    generation,
    type: "PATCH",
  } satisfies SyncServerFrame);
  if (new TextEncoder().encode(frame).byteLength <= SYNC_FRAME_BYTES) {
    return [frame];
  }
  const payload = JSON.stringify(batch);
  if (new TextEncoder().encode(payload).byteLength > 12 * 1024 * 1024) {
    throw new Error("Sync batch exceeds the transport limit.");
  }
  // JSON escaping and UTF-8 can each expand a slice; leave room for both and the envelope.
  const sliceSize = Math.floor((SYNC_FRAME_BYTES - 2048) / 6);
  const total = Math.ceil(payload.length / sliceSize);
  if (total > 256) {
    throw new Error("Sync batch exceeds the transport limit.");
  }
  return Array.from({ length: total }, (_, index) =>
    JSON.stringify({
      checkpoint: { epoch: batch.epoch, sequence: batch.sequence },
      generation,
      index,
      mailboxId: batch.mailboxId,
      payload: payload.slice(index * sliceSize, (index + 1) * sliceSize),
      total,
      type: "CHUNK",
    } satisfies SyncServerFrame)
  );
};
