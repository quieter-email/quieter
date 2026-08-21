import { composeEmailInputSchema } from "@quieter/ai/chat-agent";
import type { ComposeEmailInput } from "@quieter/ai/chat-agent";
import type { RouterInputs } from "@quieter/orpc";

type ChatToolPartLike = {
  input?: unknown;
  state: string;
  toolCallId: string;
  type: string;
};

/**
 * Reads the draft the model proposed for an open compose_email tool call.
 * Returns null for anything that is not a live, schema-valid proposal.
 */
export const parseComposeProposal = (
  part: ChatToolPartLike
): {
  input: Omit<ComposeEmailInput, "action">;
  toolCallId: string;
} | null => {
  if (part.type !== "tool-compose_email" || part.state !== "input-available") {
    return null;
  }
  const parsed = composeEmailInputSchema.safeParse(part.input);
  if (!parsed.success) {
    return null;
  }
  const { action: _action, ...proposal } = parsed.data;
  return { input: proposal, toolCallId: part.toolCallId };
};

export const toChatComposeMessageInput = (message: {
  bcc: string;
  bodyText: string;
  cc: string;
  subject: string;
  to: string;
}): RouterInputs["mail"]["sendMessage"]["message"] => ({
  attachments: [],
  // The MIME builder substitutes an empty alternative with "<p></p>", which
  // HTML-preferring clients would render as a blank email.
  bodyHtml: `<p>${message.bodyText
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", "<br>")}</p>`,
  bodyText: message.bodyText,
  inlineImages: [],
  localId: crypto.randomUUID(),
  recipients: {
    bcc: message.bcc,
    cc: message.cc,
    to: message.to,
  },
  saveStatus: "saved",
  subject: message.subject,
  updatedAt: Date.now(),
});
