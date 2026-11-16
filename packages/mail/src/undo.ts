import { z } from "zod";

const sourceIdSchema = z.string().trim().min(1).max(255);

export const mailUndoReceiptIdSchema = z.templateLiteral([
  z.enum(["placement", "snooze", "message"]),
  ":",
  z.uuid(),
]);
export type MailUndoReceiptId = z.infer<typeof mailUndoReceiptIdSchema>;

export const mailUndoInputSchema = z.strictObject({
  mailboxId: sourceIdSchema,
  receipts: z
    .array(mailUndoReceiptIdSchema)
    .min(1)
    .max(1000)
    .transform((receipts) => [...new Set(receipts)].toSorted()),
});
export type MailUndoInput = z.infer<typeof mailUndoInputSchema>;

export const mailUndoReceiptSchema = z.strictObject({
  expiresAt: z.iso.datetime({ offset: true }),
  id: mailUndoReceiptIdSchema,
});
export type MailUndoReceipt = z.infer<typeof mailUndoReceiptSchema>;

export const mailUndoOfferSchema = z
  .strictObject({
    mailboxId: sourceIdSchema,
    receipts: z.array(mailUndoReceiptSchema).min(1).max(1000),
  })
  .refine(
    (offer) =>
      new Set(offer.receipts.map((receipt) => receipt.id)).size ===
      offer.receipts.length,
    "An action can appear only once in an Undo offer."
  );
export type MailUndoOffer = z.infer<typeof mailUndoOfferSchema>;

const itemFields = {
  messageIds: z.array(sourceIdSchema).max(1000),
  receiptId: mailUndoReceiptIdSchema,
  replayed: z.boolean(),
};
export const mailUndoItemSchema = z.discriminatedUnion("status", [
  z.strictObject({
    ...itemFields,
    status: z.enum(["compensated", "unchanged"]),
    threadId: sourceIdSchema,
  }),
  z.strictObject({
    ...itemFields,
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(1000),
    status: z.enum([
      "expired",
      "denied",
      "changed",
      "failed",
      "pending",
      "uncertain",
    ]),
    threadId: sourceIdSchema.nullable(),
  }),
]);
export type MailUndoItem = z.infer<typeof mailUndoItemSchema>;

export const mailUndoResultSchema = z
  .strictObject({
    items: z.array(mailUndoItemSchema).max(1000),
    mailboxId: sourceIdSchema,
  })
  .refine(
    (result) =>
      result.items.reduce((total, item) => total + item.messageIds.length, 0) <=
      1000,
    "An Undo result can include at most 1,000 messages."
  );
export type MailUndoResult = z.infer<typeof mailUndoResultSchema>;
