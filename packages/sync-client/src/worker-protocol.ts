import {
  syncCheckpointSchema,
  syncCommandSchema,
  syncIdSchema,
} from "@quieter/sync";
import { z } from "zod";

export const syncApiRequestSchema = z.discriminatedUnion("method", [
  z.object({ input: z.null(), method: z.literal("connection") }),
  z.object({
    input: z.object({ mailboxId: syncIdSchema }),
    method: z.literal("snapshot"),
  }),
  z.object({
    input: z.object({
      checkpoint: syncCheckpointSchema,
      mailboxId: syncIdSchema,
    }),
    method: z.literal("replay"),
  }),
  z.object({
    input: z.object({
      mailboxId: syncIdSchema,
      threadIds: z.array(syncIdSchema),
    }),
    method: z.literal("hydrate"),
  }),
  z.object({
    input: z.object({
      hash: z.string(),
      mailboxId: syncIdSchema,
      messageId: syncIdSchema,
    }),
    method: z.literal("body"),
  }),
  z.object({ input: syncCommandSchema, method: z.literal("submit") }),
  z.object({
    input: z.object({ commandId: z.string(), mailboxId: syncIdSchema }),
    method: z.literal("command"),
  }),
]);
export type SyncApiRequest = z.infer<typeof syncApiRequestSchema>;
export const syncWorkerActionSchema = z.discriminatedUnion("method", [
  z.object({
    input: z.object({
      mobile: z.boolean(),
      reducedData: z.boolean(),
      userId: z.string(),
    }),
    method: z.literal("initialize"),
  }),
  z.object({
    input: z.object({ mailboxIds: z.array(syncIdSchema).max(32) }),
    method: z.literal("subscribe"),
  }),
  z.object({
    input: z.object({
      mailboxId: syncIdSchema,
      priority: z.number().int().min(0).max(5),
      threadIds: z.array(syncIdSchema),
    }),
    method: z.literal("warm"),
  }),
  z.object({
    input: z.object({
      mailboxId: syncIdSchema,
      threadIds: z.array(syncIdSchema),
    }),
    method: z.literal("pin"),
  }),
  z.object({
    input: z.object({ mailboxId: syncIdSchema, threadId: syncIdSchema }),
    method: z.literal("thread"),
  }),
  z.object({ input: syncCommandSchema, method: z.literal("command") }),
  z.object({ input: z.boolean(), method: z.literal("visible") }),
  z.object({ input: z.boolean(), method: z.literal("online") }),
  z.object({ input: z.number().positive(), method: z.literal("budget") }),
  z.object({
    input: z.object({ mailboxId: syncIdSchema }),
    method: z.literal("revoke"),
  }),
  z.object({
    input: z.object({ purge: z.boolean() }),
    method: z.literal("stop"),
  }),
]);
export type SyncWorkerAction = z.infer<typeof syncWorkerActionSchema>;
export const syncWorkerErrorSchema = z.object({
  code: z.string().optional(),
  message: z.string(),
});
export const syncReceiptSchema = z.object({
  commandId: z.string(),
  error: z.string().nullable(),
  status: z.enum(["accepted", "running", "applied", "failed"]),
});
