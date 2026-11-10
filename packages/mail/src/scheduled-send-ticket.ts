import { z } from "zod";

import { verifyMailPayload } from "./updates";

export const scheduledSendScopeSchema = z.object({
  id: z.uuid(),
  mailboxId: z.string().min(1).max(255),
  userId: z.string().min(1).max(255),
});
export type ScheduledSendScope = z.infer<typeof scheduledSendScopeSchema>;

export const scheduledSendWakeSchema = scheduledSendScopeSchema.extend({
  expiresAt: z.number().int().positive(),
  purpose: z.literal("scheduled-send-wake"),
});
export const scheduledSendDispatchSchema = scheduledSendScopeSchema.extend({
  expiresAt: z.number().int().positive(),
  purpose: z.literal("scheduled-send-dispatch"),
});
export const scheduledSendDispatchResultSchema = z.object({
  nextWakeAt: z.number().int().nonnegative().nullable(),
});

const ticketSchema = z.discriminatedUnion("purpose", [
  scheduledSendWakeSchema,
  scheduledSendDispatchSchema,
]);

export const readScheduledSendTicket = async (
  request: Request,
  secret: string | undefined,
  purpose: z.infer<typeof ticketSchema>["purpose"]
): Promise<
  | { ok: true; ticket: z.infer<typeof ticketSchema> }
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
