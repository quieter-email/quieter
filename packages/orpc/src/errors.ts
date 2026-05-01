import { z } from "zod";

export const rateLimitedErrorDataSchema = z.object({
  retryAfter: z.number().int().nonnegative(),
  provider: z.enum(["gmail", "server"]),
});

export const mailboxScopeRepairRequiredErrorDataSchema = z.object({
  mailboxId: z.string().min(1),
  providerAccountId: z.string().min(1),
  emailAddress: z.string().min(1),
});

export const orpcErrorMap = {
  UNAUTHORIZED: {},
  FORBIDDEN: {},
  NOT_FOUND: {},
  RATE_LIMITED: {
    data: rateLimitedErrorDataSchema,
    status: 429,
  },
  MAILBOX_SCOPE_REPAIR_REQUIRED: {
    data: mailboxScopeRepairRequiredErrorDataSchema,
    status: 409,
  },
} as const;

export type RateLimitedErrorData = z.infer<typeof rateLimitedErrorDataSchema>;
export type MailboxScopeRepairRequiredErrorData = z.infer<
  typeof mailboxScopeRepairRequiredErrorDataSchema
>;
