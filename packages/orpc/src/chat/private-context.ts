import type { ChatMessagePart } from "@quieter/database/schema";
import { z } from "zod";

const privateContextPartSchema = z.strictObject({
  type: z.literal("data-ai-private-context"),
  used: z.boolean(),
});

export const hasPrivateChatContext = (parts: readonly ChatMessagePart[]) => {
  const markers = parts.filter(
    (part) => part.type === "data-ai-private-context"
  );
  if (markers.length !== 1) {
    return true;
  }
  const marker = privateContextPartSchema.safeParse(markers[0]);
  return !marker.success || marker.data.used;
};
