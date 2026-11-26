import { z } from "zod";

export const mailChangeVersionSchema = z.string().regex(/^\d{1,19}$/u);

export const mailboxChangeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["message.added", "message.deleted", "message.labels"]),
    messageId: z.string().min(1),
    threadId: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal("capture.changed"),
    threadId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("importance.changed"),
    threadId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("verification-code.available"),
    threadId: z.string().min(1).optional(),
  }),
  z.object({ kind: z.literal("mailbox.reconcile") }),
]);
export type MailboxChange = z.infer<typeof mailboxChangeSchema>;

const mailboxChangeKindSchema = z.enum([
  "message.added",
  "message.deleted",
  "message.labels",
  "capture.changed",
  "importance.changed",
  "verification-code.available",
  "mailbox.reconcile",
]);

export const mailUpdateSchema = z.object({
  change: z
    .object({
      kinds: z.array(mailboxChangeKindSchema).min(1).max(7),
      version: mailChangeVersionSchema,
    })
    .optional(),
  eventId: z.uuid(),
  mailboxId: z.string().min(1),
  reminderId: z.uuid().optional(),
  revision: z.string().regex(/^\d+$/u).optional(),
  scheduleVersion: z.number().int().positive().optional(),
  threadIds: z.array(z.string().min(1)).max(100).optional(),
  type: z.enum([
    "mailbox.changed",
    "labels.changed",
    "details.changed",
    "reminders.changed",
  ]),
});
export type MailUpdate = z.infer<typeof mailUpdateSchema>;

export const mailConnectionSchema = z.object({
  expiresAt: z.number().int().positive(),
  purpose: z.literal("mail-connection"),
  userId: z.string().min(1),
});

export const gmailAutomationKindSchema = z.enum([
  "actions",
  "importance",
  "memory",
  "reminders",
]);
export const gmailMailboxWakeSchema = z.strictObject({
  expiresAt: z.number().int().positive(),
  kind: z.union([gmailAutomationKindSchema, z.literal("sync")]),
  mailboxId: z.string().min(1).max(256),
  purpose: z.literal("gmail-mailbox-wake"),
});
export const GMAIL_MAILBOX_WAKE_PATH = "/gmail/mailbox/wake";
export type GmailMailboxWake = z.infer<typeof gmailMailboxWakeSchema>;

export const signMailPayload = async (
  payload: string,
  secret: string
): Promise<string> => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(payload))
  );
  return Array.from(signature, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

export const verifyMailPayload = async (
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> => {
  if (!/^[a-f0-9]{64}$/u.test(signature)) {
    return false;
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["verify"]
  );
  const bytes = Uint8Array.from(signature.match(/../gu) ?? [], (byte) =>
    Number.parseInt(byte, 16)
  );
  return await crypto.subtle.verify(
    "HMAC",
    key,
    bytes,
    encoder.encode(payload)
  );
};
