import { z } from "zod";

export const aiMemoryProvenanceSchema = z.object({
  confidence: z.number().min(0).max(1),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(),
  lastConfirmedAt: z.iso.datetime(),
  reinforcementCount: z.number().int().positive(),
  source: z.enum(["explicit", "feedback", "inferred", "migration"]),
});
export type AiMemoryProvenance = z.infer<typeof aiMemoryProvenanceSchema>;
