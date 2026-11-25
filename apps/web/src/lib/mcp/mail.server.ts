import { ORPCError } from "@orpc/server";
import { managedMailboxRuleDefinitionSchema } from "@quieter/mail/mailbox-organization";
import { MAX_SEND_PAYLOAD_BYTES } from "@quieter/mail/send";
import { z } from "zod";

export const composeFields = new Map([
  ["mail.saveDraft", "draft"],
  ["mail.sendDraft", "draft"],
  ["mail.sendMessage", "message"],
  ["scheduledSends.create", "message"],
]);

const attachmentFileSchema = z.object({
  base64: z.base64().max(MAX_SEND_PAYLOAD_BYTES),
});

const attachmentSchema = z.looseObject({
  file: attachmentFileSchema.optional(),
  mimeType: z.string(),
  name: z.string(),
});

const composeFilesSchema = z.looseObject({
  attachments: z.array(attachmentSchema).default([]),
  bodyHtml: z.string().default(""),
  inlineImages: z.array(attachmentSchema).default([]),
  localId: z.string().min(1).optional(),
  recipients: z.object({
    bcc: z.string().default(""),
    cc: z.string().default(""),
    to: z.string(),
  }),
  saveStatus: z.string().default("idle"),
  sendOperationId: z.uuid().optional(),
  updatedAt: z.number().optional(),
});

const decodeAttachment = (attachment: z.infer<typeof attachmentSchema>) => {
  if (attachment.file === undefined) {
    return attachment;
  }
  const bytes = Uint8Array.fromBase64(attachment.file.base64);
  return {
    ...attachment,
    file: new File([bytes], attachment.name, { type: attachment.mimeType }),
    size: bytes.byteLength,
  };
};

export const prepareMailInput = (
  action: string,
  input: Record<string, unknown>
) => {
  const field = composeFields.get(action);
  if (field === undefined) {
    return { input };
  }

  const parsed = composeFilesSchema.safeParse(input[field]);
  if (!parsed.success) {
    throw new ORPCError("BAD_REQUEST", {
      message: z.prettifyError(parsed.error),
    });
  }
  if (
    action !== "mail.saveDraft" &&
    parsed.data.sendOperationId === undefined
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Set a new sendOperationId UUID for this send. Reuse that UUID for retries.",
    });
  }
  const localId = parsed.data.localId ?? parsed.data.sendOperationId;
  if (localId === undefined) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Set a localId for this draft. Reuse it when retrying a save.",
    });
  }

  const attachments = parsed.data.attachments.map(decodeAttachment);
  const inlineImages = parsed.data.inlineImages.map(decodeAttachment);
  const preview = {
    ...input,
    [field]: {
      ...parsed.data,
      attachments: attachments.map(
        ({ file: _file, ...reference }) => reference
      ),
      inlineImages: inlineImages.map(
        ({ file: _file, ...reference }) => reference
      ),
    },
  };
  return {
    input: {
      ...input,
      [field]: {
        ...parsed.data,
        attachments,
        inlineImages,
        localId,
        updatedAt: parsed.data.updatedAt ?? Date.now(),
      },
    },
    preview,
  };
};

const mailChangeInput = z.object({
  command: z.object({
    addIds: z.array(z.string()).optional(),
    destination: z.string().optional(),
    kind: z.string(),
  }),
  targets: z.array(z.object({ messageIds: z.array(z.string()) })),
});
const destructiveLabelInput = z.object({
  addLabelIds: z.array(z.string()).optional(),
});

export const getMailDeleteEffect = (action: string, input: unknown) => {
  if (action === "mail.applyChanges") {
    const { command, targets } = mailChangeInput.parse(input);
    const trashesMail =
      command.kind === "delete-permanently" ||
      (command.kind === "move" && command.destination === "trash") ||
      (command.kind === "set-labels" &&
        command.addIds?.includes("TRASH") === true);
    if (trashesMail) {
      const count = targets.reduce(
        (sum, target) => sum + target.messageIds.length,
        0
      );
      return count >= 10 ? "bulk_delete" : "delete";
    }
  } else {
    const { addLabelIds } = destructiveLabelInput.parse(input);
    if (addLabelIds?.includes("TRASH") === true) {
      return action === "mail.updateThreadLabels" ? "bulk_delete" : "delete";
    }
  }
  return null;
};

export const backfillScopeSchema = z.object({
  mailboxId: z.string(),
  ruleId: z.string(),
});
export const managedRulesSchema = z.array(
  managedMailboxRuleDefinitionSchema.extend({
    id: z.string(),
    revision: z.string(),
  })
);
const ruleInputSchema = z.object({
  definition: managedMailboxRuleDefinitionSchema,
});

export const getMailChangePolicy = (action: string, input: unknown) => {
  if (
    action === "mail.createManagedRule" ||
    action === "mail.updateManagedRule" ||
    action === "mail.startManagedRuleBackfill"
  ) {
    const { definition } = ruleInputSchema.parse(input);
    const changesDelivery =
      definition.enabled &&
      definition.actions?.some(
        (ruleAction) =>
          ruleAction.kind === "forward" ||
          (ruleAction.kind === "move" && ruleAction.destination === "trash") ||
          (ruleAction.kind === "set-labels" &&
            ruleAction.addIds.includes("TRASH"))
      );
    return changesDelivery === true ? "automation" : "write";
  }
  if (action === "connectors.disconnect") {
    const { connectionId } = z
      .object({ connectionId: z.string().optional() })
      .parse(input);
    return connectionId === undefined ? "bulk_delete" : "delete";
  }
  return getMailDeleteEffect(action, input) ?? "write";
};

const mailResultsSchema = z.looseObject({
  items: z.array(z.unknown()).optional(),
  messages: z.array(z.unknown()).optional(),
});
const messageReferenceSchema = z.looseObject({
  id: z.string().optional(),
  messageId: z.string().optional(),
  threadId: z.string().optional(),
});

export const withMailLinks = (
  action: string,
  input: Record<string, unknown>,
  result: unknown,
  webOrigin: string
) => {
  if (
    typeof input.mailboxId !== "string" ||
    (action !== "mail.listThreads" &&
      action !== "mail.getThread" &&
      action !== "search.history")
  ) {
    return result;
  }
  const { mailboxId } = input;
  const parsed = mailResultsSchema.safeParse(result);
  if (!parsed.success) {
    return result;
  }

  const resultField = action === "search.history" ? "items" : "messages";
  const messages = parsed.data[resultField];
  if (messages === undefined) {
    return result;
  }
  return {
    ...parsed.data,
    [resultField]: messages.map((message) => {
      const reference = messageReferenceSchema.safeParse(message);
      if (!reference.success) {
        return message;
      }
      const { id, messageId = id, threadId = input.threadId } = reference.data;
      if (typeof threadId !== "string" || messageId === undefined) {
        return message;
      }
      const url = new URL("/", webOrigin);
      url.search = new URLSearchParams({
        mailboxId,
        messageId,
        threadId,
      }).toString();
      return { ...reference.data, webUrl: url.href };
    }),
  };
};

export const serializeMailAttachment = async (
  result: unknown,
  input: Record<string, unknown>,
  webOrigin: string
) => {
  const attachment = z
    .object({
      attachmentId: z.string(),
      file: z.instanceof(File),
      size: z.number(),
    })
    .parse(result);
  const { attachmentId, file, size } = attachment;
  const metadata = { attachmentId, mimeType: file.type, name: file.name, size };
  if (file.size > Math.floor(MAX_SEND_PAYLOAD_BYTES * 0.75)) {
    const url = new URL("/", webOrigin);
    url.search = new URLSearchParams({
      mailboxId: String(input.mailboxId),
      messageId: String(input.messageId),
      ...(typeof input.threadId === "string"
        ? { threadId: input.threadId }
        : {}),
    }).toString();
    return { ...metadata, status: "download_in_quieter", webUrl: url.href };
  }
  return {
    ...metadata,
    base64: new Uint8Array(await file.arrayBuffer()).toBase64(),
  };
};
