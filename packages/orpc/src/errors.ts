import { z } from "zod";

export const rateLimitedErrorDataSchema = z.object({
  provider: z.enum(["gmail", "server"]),
  retryAfter: z.number().int().nonnegative(),
});

export const mailboxScopeRepairRequiredErrorDataSchema = z.object({
  emailAddress: z.string().min(1),
  mailboxId: z.string().min(1),
});

export const orpcErrorMap = {
  FORBIDDEN: {},
  MAILBOX_SCOPE_REPAIR_REQUIRED: {
    data: mailboxScopeRepairRequiredErrorDataSchema,
    status: 409,
  },
  NOT_FOUND: {},
  RATE_LIMITED: {
    data: rateLimitedErrorDataSchema,
    status: 429,
  },
  UNAUTHORIZED: {},
} as const;

export type RateLimitedErrorData = z.infer<typeof rateLimitedErrorDataSchema>;
export type MailboxScopeRepairRequiredErrorData = z.infer<
  typeof mailboxScopeRepairRequiredErrorDataSchema
>;
