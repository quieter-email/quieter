import { z } from "zod";

export const liveSyncTokenPayloadSchema = z.object({
  emailAddress: z.email(),
  expiresAt: z.number().int().positive(),
  issuedAt: z.number().int().positive(),
  mailboxId: z.string().min(1),
  nonce: z.uuid(),
  userId: z.string().min(1),
  version: z.literal(1),
});
