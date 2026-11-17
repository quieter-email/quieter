import { ORPCError } from "@orpc/server";
import { getUnresolvedSnippetFields } from "@quieter/mail/compose/schema";

export const assertSnippetFieldsResolved = (message: {
  bodyHtml?: string;
  bodyText?: string;
}) => {
  const fields = getUnresolvedSnippetFields(message);
  if (fields.length > 0) {
    throw new ORPCError("BAD_REQUEST", {
      data: { sendNotStarted: true, unresolvedSnippetFields: fields },
      message: "Complete the marked snippet fields before sending.",
    });
  }
};
