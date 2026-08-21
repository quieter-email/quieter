import { composeEmailInputSchema } from "@quieter/ai/chat-agent";
import type { ComposeEmailInput } from "@quieter/ai/chat-agent";
import type { RouterInputs } from "@quieter/orpc";

import type { ChatToolPart } from "./chat-tools";

export type ComposeValues = {
  bcc: string;
  bodyText: string;
  cc: string;
  subject: string;
  to: string;
};

/**
 * Builds the HTML alternative from plain text. Shared by draft saving and
 * sending so the validated body matches what actually goes out.
 */
export const composeBodyHtmlFromText = (bodyText: string) =>
  `<p>${bodyText
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", "<br>")}</p>`;

/**
 * Reads the draft the model proposed for an open compose_email tool call.
 * Returns null for anything that is not a live, schema-valid proposal.
 */
export const parseComposeProposal = (
  part: ChatToolPart
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

export const toChatComposeMessageInput = (
  message: ComposeValues
): RouterInputs["mail"]["sendMessage"]["message"] => ({
  attachments: [],
  // The MIME builder substitutes an empty alternative with "<p></p>", which
  // HTML-preferring clients would render as a blank email.
  bodyHtml: composeBodyHtmlFromText(message.bodyText),
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
