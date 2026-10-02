import { ORPCError } from "@orpc/server";

const messages = new Map([
  [
    "managed_mail_label_mailbox_normalized_name_unique",
    "A label with this name already exists.",
  ],
  [
    "managed_mail_rule_mailbox_normalized_name_unique",
    "A rule with this name already exists.",
  ],
]);

export const throwMailboxOrganizationNameConflict = (error: unknown): never => {
  // oxlint-disable-next-line prefer-destructuring -- Traverse the cause chain in the loop update.
  for (let cause = error; cause instanceof Error; cause = cause.cause) {
    if (
      "code" in cause &&
      cause.code === "23505" &&
      "constraint_name" in cause &&
      typeof cause.constraint_name === "string"
    ) {
      const message = messages.get(cause.constraint_name);
      if (message !== undefined) {
        throw new ORPCError("CONFLICT", { cause: error, message });
      }
    }
  }
  throw error;
};
