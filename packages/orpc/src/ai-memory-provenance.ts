import type { AiMemoryProvenance } from "@quieter/ai/ai-memory";
import type { aiMemory } from "@quieter/database/schema";

export const serializeAiMemoryProvenance = (
  memory: Pick<typeof aiMemory.$inferSelect, keyof AiMemoryProvenance>
): AiMemoryProvenance => ({
  confidence: memory.confidence,
  createdAt: memory.createdAt.toISOString(),
  expiresAt: memory.expiresAt?.toISOString() ?? null,
  lastConfirmedAt: memory.lastConfirmedAt.toISOString(),
  reinforcementCount: memory.reinforcementCount,
  source: memory.source,
});
