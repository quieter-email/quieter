import { chatModelSchema } from "@quieter/ai/chat-models";
import { reportAiUsage } from "@quieter/billing";
import { db } from "@quieter/database/client";
import { gmailAutoLabelEvent } from "@quieter/database/schema";
import { eq } from "drizzle-orm";

export const reportAutoLabelUsage = async (event: {
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  id: string;
  mailboxId: string;
  model: string | null;
  promptTokens: number | null;
  usageReportedAt: Date | null;
  userId: string;
}) => {
  const model = chatModelSchema.safeParse(event.model);
  if (
    event.usageReportedAt ||
    !model.success ||
    event.promptTokens === null ||
    event.completionTokens === null ||
    event.costUsd === null
  ) {
    return;
  }

  try {
    await reportAiUsage({
      completionTokens: event.completionTokens,
      costUsd: event.costUsd,
      externalId: event.id,
      mailboxId: event.mailboxId,
      model: model.data,
      promptTokens: event.promptTokens,
      promptTokensDetails: {
        cacheWriteTokens: event.cacheWriteTokens ?? 0,
        cachedTokens: event.cachedTokens ?? 0,
      },
      usageKind: "autoLabel",
      userId: event.userId,
    });
    await db
      .update(gmailAutoLabelEvent)
      .set({
        lastError: null,
        updatedAt: new Date(),
        usageReportedAt: new Date(),
      })
      .where(eq(gmailAutoLabelEvent.id, event.id));
  } catch (error) {
    await db
      .update(gmailAutoLabelEvent)
      .set({
        lastError: `AI usage reporting failed: ${error instanceof Error ? error.message.slice(0, 2000) : "Unknown usage reporting error."}`,
        updatedAt: new Date(),
      })
      .where(eq(gmailAutoLabelEvent.id, event.id));
  }
};
