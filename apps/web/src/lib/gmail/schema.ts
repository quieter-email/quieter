import { z } from "zod";

export const listMessagesSchema = z.object({
  messages: z.array(
    z.object({
      id: z.string(),
      threadId: z.string(),
    }),
  ),
  nextPageToken: z.string().optional(),
  resultSizeEstimate: z.number().optional(),
});

const headerSchema = z.object({
  name: z.string(),
  value: z.string(),
});

const messagePartBodySchema = z.object({
  attachmentId: z.string().optional(),
  size: z.number().optional(),
  data: z.string().optional(),
});

type MessagePart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: MessagePart[];
};

const messagePartSchema: z.ZodType<MessagePart> = z.lazy(() =>
  z.object({
    partId: z.string().optional(),
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(headerSchema).optional(),
    body: messagePartBodySchema.optional(),
    parts: z.array(messagePartSchema).optional(),
  }),
);

const classificationLabelFieldValueSchema = z.object({
  fieldId: z.string(),
  selection: z.string().optional(),
});

const classificationLabelValueSchema = z.object({
  labelId: z.string(),
  fields: z.array(classificationLabelFieldValueSchema).optional(),
});

export const getMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).optional(),
  snippet: z.string().optional(),
  historyId: z.string().optional(),
  internalDate: z.string().optional(),
  payload: messagePartSchema.optional(),
  sizeEstimate: z.number().optional(),
  raw: z.string().optional(),
  classificationLabelValues: z.array(classificationLabelValueSchema).optional(),
});

export const getThreadSchema = z.object({
  id: z.string(),
  historyId: z.string().optional(),
  snippet: z.string().optional(),
  messages: z.array(getMessageSchema).optional(),
});
