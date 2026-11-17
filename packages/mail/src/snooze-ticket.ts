import { z } from "zod";

import { verifyMailPayload } from "./updates";

export const mailSnoozeScopeSchema = z.strictObject({
  id: z.uuid(),
  mailboxId: z.string().min(1).max(255),
});
export type MailSnoozeScope = z.infer<typeof mailSnoozeScopeSchema>;

export const mailSnoozeWakeSchema = mailSnoozeScopeSchema.extend({
  expiresAt: z.number().int().positive(),
  purpose: z.literal("mail-snooze-wake"),
});
export const mailSnoozeDispatchSchema = mailSnoozeScopeSchema.extend({
  expiresAt: z.number().int().positive(),
  purpose: z.literal("mail-snooze-dispatch"),
});
export const mailSnoozeDispatchResultSchema = z.strictObject({
  nextWakeAt: z.number().int().nonnegative().nullable(),
});

const ticketSchema = z.discriminatedUnion("purpose", [
  mailSnoozeWakeSchema,
  mailSnoozeDispatchSchema,
]);
export type MailSnoozeTicket = z.infer<typeof ticketSchema>;
export type MailSnoozeTicketPurpose = MailSnoozeTicket["purpose"];

export const readMailSnoozeTicket = async (
  request: Request,
  secret: string | undefined,
  purpose: MailSnoozeTicketPurpose
): Promise<
  | { ok: true; ticket: MailSnoozeTicket }
  | { ok: false; status: 400 | 401 | 413 }
> => {
  if (!secret || request.body === null) {
    return { ok: false, status: 401 };
  }
  const limit = 4096;
  if (Number(request.headers.get("content-length")) > limit) {
    return { ok: false, status: 413 };
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      length += chunk.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        return { ok: false, status: 413 };
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body: string;
  try {
    body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, status: 400 };
  }
  if (
    !(await verifyMailPayload(
      body,
      request.headers.get("x-mail-signature") ?? "",
      secret
    ))
  ) {
    return { ok: false, status: 401 };
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return { ok: false, status: 400 };
  }
  const parsed = ticketSchema.safeParse(value);
  const now = Date.now();
  if (
    !parsed.success ||
    parsed.data.purpose !== purpose ||
    parsed.data.expiresAt <= now ||
    parsed.data.expiresAt > now + 30_000
  ) {
    return { ok: false, status: 401 };
  }
  return { ok: true, ticket: parsed.data };
};
