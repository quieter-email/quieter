import { normalizeComposeBodyHtml } from "@quieter/mail/compose/mime";
import {
  composeDraftInputSchema,
  composeDraftSeededBySchema,
} from "@quieter/mail/compose/schema";
import { z } from "zod";

import { hashRequest } from "../request-hash";
import { assertSnippetFieldsResolved } from "./snippet-fields";

export type ComposeSnippetMessage = Pick<
  z.infer<typeof composeDraftInputSchema>,
  "bodyHtml" | "bodyText" | "draftAnchor" | "inlineImages"
>;

export const composeSendReadinessInputSchema = composeDraftInputSchema
  .pick({ bodyHtml: true, bodyText: true, draftAnchor: true })
  .extend({
    inlineImages: z.array(
      composeDraftInputSchema.shape.inlineImages.element
        .omit({ file: true })
        .strict()
    ),
    mailboxId: z.string().trim().min(1),
  })
  .strict();

export const composeSnippetQuoteProofSchema = z.strictObject({
  actorUserId: z.string().min(1),
  authoredBodyHtml: z.string(),
  authoredBodyText: z.string(),
  bodyHash: z.string().regex(/^[a-f0-9]{64}$/u),
  mailboxId: z.string().min(1),
  sendOperationId: z.string().min(1),
  source: z.strictObject({
    mailboxId: z.string().min(1),
    messageId: z.string().min(1),
    seededBy: composeDraftSeededBySchema,
    threadId: z.string().min(1),
  }),
  version: z.literal(1),
});
export type ComposeSnippetQuoteProof = z.infer<
  typeof composeSnippetQuoteProofSchema
>;

export const hashComposeSnippetBody = (message: ComposeSnippetMessage) =>
  hashRequest({
    bodyHtml: normalizeComposeBodyHtml(message),
    bodyText: message.bodyText,
  });

export const assertComposeSnippetFieldsResolved = (input: {
  actorUserId: string;
  mailboxId: string;
  message: ComposeSnippetMessage;
  sendOperationId: string;
  snippetQuote?: ComposeSnippetQuoteProof;
}) => {
  const { message, snippetQuote } = input;
  const anchor = message.draftAnchor;
  const proven =
    snippetQuote !== undefined &&
    snippetQuote.actorUserId === input.actorUserId &&
    snippetQuote.mailboxId === input.mailboxId &&
    snippetQuote.sendOperationId === input.sendOperationId &&
    snippetQuote.source.mailboxId === input.mailboxId &&
    snippetQuote.source.messageId === anchor?.sourceMessageId &&
    snippetQuote.source.threadId === anchor?.sourceThreadId &&
    snippetQuote.source.seededBy === anchor?.seededBy &&
    snippetQuote.bodyHash === hashComposeSnippetBody(message);
  assertSnippetFieldsResolved(
    proven
      ? {
          bodyHtml: snippetQuote.authoredBodyHtml,
          bodyText: snippetQuote.authoredBodyText,
        }
      : {
          bodyHtml: normalizeComposeBodyHtml(message),
          bodyText: message.bodyText,
        }
  );
};
