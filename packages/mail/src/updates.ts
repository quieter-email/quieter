import { z } from "zod";

export const mailUpdateSchema = z.object({
  eventId: z.uuid(),
  mailboxId: z.string().min(1),
  threadIds: z.array(z.string().min(1)).max(100).optional(),
  type: z.enum(["mailbox.changed", "labels.changed", "details.changed"]),
});
export type MailUpdate = z.infer<typeof mailUpdateSchema>;

export const mailConnectionSchema = z.object({
  expiresAt: z.number().int().positive(),
  purpose: z.literal("mail-connection"),
  userId: z.string().min(1),
});

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
