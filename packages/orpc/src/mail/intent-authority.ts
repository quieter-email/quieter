import { ORPCError } from "@orpc/server";
import { reportError } from "@quieter/observability";
import { z } from "zod";

import {
  aiOperationOriginSchema,
  aiOriginSchema,
  captureAiOrigin,
} from "../ai-authority";
import type { AiOperationOrigin } from "../ai-authority";
import { getMailboxMemoryActor } from "../ai-memory-capture";

const mailSendIntentAuthoritySchema = z.strictObject({
  learning: aiOriginSchema.extend({ mode: z.literal("automation") }).nullable(),
  operation: aiOperationOriginSchema,
});
export type MailSendIntentAuthority = z.infer<
  typeof mailSendIntentAuthoritySchema
>;

export const captureMailSendIntentAuthority = async (input: {
  mailboxId: string;
  origin: AiOperationOrigin;
  userId: string;
}): Promise<MailSendIntentAuthority> => {
  let learning: MailSendIntentAuthority["learning"] = null;
  try {
    const actor = await getMailboxMemoryActor({
      actorUserId: input.userId,
      mailboxId: input.mailboxId,
    });
    if (actor?.userId === input.userId) {
      const original =
        input.origin.kind === "ai"
          ? input.origin
          : await captureAiOrigin({
              mailboxId: input.mailboxId,
              mode: "automation",
              userId: input.userId,
            });
      learning = { ...original, mode: "automation" };
    }
  } catch (error) {
    if (!(error instanceof ORPCError) || error.status >= 500) {
      reportError(
        new Error("Mail learning permissions could not be captured."),
        { operation: "mail-send:capture-learning-authority" }
      );
    }
  }
  return { learning, operation: input.origin };
};

export const readMailSendIntentAuthority = (
  value: unknown,
  binding: { mailboxId: string; userId: string }
): MailSendIntentAuthority | null => {
  if (value === undefined) {
    return null;
  }
  const parsed = mailSendIntentAuthoritySchema.safeParse(value);
  if (!parsed.success) {
    reportError(
      new Error("Saved mail intent permissions could not be authorized."),
      { operation: "mail-send:read-intent-authority" }
    );
    return null;
  }
  const { learning, operation } = parsed.data;
  if (
    (operation.kind === "ai" &&
      (operation.mailboxId !== binding.mailboxId ||
        operation.userId !== binding.userId)) ||
    (learning !== null &&
      (learning.mailboxId !== binding.mailboxId ||
        learning.userId !== binding.userId ||
        (operation.kind === "ai" &&
          learning.policyVersion !== operation.policyVersion)))
  ) {
    reportError(
      new Error("Saved mail intent belongs to a different inbox or account."),
      { operation: "mail-send:read-intent-authority" }
    );
    return null;
  }
  return parsed.data;
};
