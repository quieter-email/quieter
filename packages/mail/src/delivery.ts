import { z } from "zod";

export const sendMessageResultSchema = z.object({
  idempotent: z.boolean().optional(),
  messageId: z.string().nullable(),
  sent: z.literal(true),
});
export type SendMessageResult = z.infer<typeof sendMessageResultSchema>;

const timestampSchema = z
  .union([z.iso.datetime(), z.date()])
  .transform((value) =>
    typeof value === "string" ? value : value.toISOString()
  );

export const deliveryStatusSchema = z.enum([
  "bounced",
  "complained",
  "delayed",
  "delivered",
  "queued",
  "rejected",
  "sent",
]);

export const deliveryEventSchema = z.object({
  diagnosticCode: z.string().nullable(),
  eventType: z.enum([
    ...deliveryStatusSchema.options,
    "opened",
    "unsubscribed",
  ]),
  occurredAt: timestampSchema,
  providerStatus: z.string().nullable(),
  reason: z.string().nullable(),
  recipient: z.string(),
});

export const messageDeliverySchema = z.object({
  events: z.array(deliveryEventSchema),
  messageId: z.string(),
  recipients: z.array(
    z.object({
      lastEventAt: timestampSchema,
      recipient: z.string(),
      status: deliveryStatusSchema,
    })
  ),
});

export const recipientSuppressionSchema = z.object({
  createdAt: timestampSchema,
  reason: z.enum(["bounce", "complaint", "manual", "unsubscribe"]),
  recipient: z.string(),
  sourceProviderMessageId: z.string().nullable(),
});

export const recipientSuppressionListSchema = z.object({
  data: z.array(recipientSuppressionSchema),
});

export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;
export type DeliveryEvent = z.infer<typeof deliveryEventSchema>;
export type MessageDelivery = z.infer<typeof messageDeliverySchema>;
export type RecipientSuppression = z.infer<typeof recipientSuppressionSchema>;
