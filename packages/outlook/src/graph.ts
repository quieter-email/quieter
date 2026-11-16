import { z } from "zod";

import {
  outlookAttachmentSchema,
  outlookFolderSchema,
  outlookMessagePatchSchema,
  outlookMessageSchema,
} from "./graph-schemas";
import type {
  OutlookAttachment,
  OutlookFolder,
  OutlookMessage,
  OutlookMessagePatch,
  OutlookSystemFolders,
} from "./graph-schemas";

export type {
  OutlookAttachment,
  OutlookFolder,
  OutlookMessage,
  OutlookMessagePatch,
  OutlookSystemFolders,
} from "./graph-schemas";
export {
  outlookAttachmentSchema,
  outlookFolderSchema,
  outlookMessagePatchSchema,
  outlookMessageSchema,
  outlookSystemFoldersSchema,
} from "./graph-schemas";

export type OutlookReadContext = { accessToken: string; signal?: AbortSignal };
export type OutlookGraphErrorCode =
  | "forbidden"
  | "invalid_cursor"
  | "invalid_response"
  | "not_found"
  | "rate_limited"
  | "temporary"
  | "unauthorized"
  | "unsupported";

export class OutlookGraphError extends Error {
  readonly code: OutlookGraphErrorCode;
  readonly retryAt?: Date;
  readonly status?: number;
  constructor(
    code: OutlookGraphErrorCode,
    options?: { retryAt?: Date; status?: number }
  ) {
    super("The mailbox request could not be completed.");
    this.name = "OutlookGraphError";
    this.code = code;
    this.retryAt = options?.retryAt;
    this.status = options?.status;
  }
}

type Resource = {
  query?: Record<string, string>;
  segments: (string | { id: string })[];
};
type Page<T> = { nextPageUrl?: string; values: T[] };
const MESSAGE_FIELDS =
  "id,conversationId,parentFolderId,changeKey,subject,body,bodyPreview,from,toRecipients,ccRecipients,bccRecipients,replyTo,internetMessageId,internetMessageHeaders,createdDateTime,receivedDateTime,sentDateTime,isRead,isDraft,importance,categories,hasAttachments,webLink";
const DELTA_FIELDS = MESSAGE_FIELDS.split(",")
  .filter((field) => field !== "body" && field !== "internetMessageHeaders")
  .join(",");
const folderPageSchema = z.object({
  "@odata.nextLink": z.string().optional(),
  value: z.array(outlookFolderSchema),
});
const messagePageSchema = z.object({
  "@odata.nextLink": z.string().optional(),
  value: z.array(outlookMessageSchema),
});
const attachmentPageSchema = z.object({
  "@odata.nextLink": z.string().optional(),
  value: z.array(outlookAttachmentSchema),
});

const getReadUrl = (resource: Resource, continuation?: string) => {
  if (
    resource.segments.some(
      (segment) =>
        typeof segment !== "string" && ["", ".", ".."].includes(segment.id)
    )
  ) {
    throw new OutlookGraphError("invalid_response");
  }
  const initial = new URL(
    `https://graph.microsoft.com/${resource.segments.map((segment) => (typeof segment === "string" ? segment : encodeURIComponent(segment.id))).join("/")}`
  );
  for (const [name, value] of Object.entries(resource.query ?? {})) {
    initial.searchParams.set(name, value);
  }
  if (continuation === undefined) {
    return initial;
  }
  let url: URL;
  try {
    url = new URL(continuation);
    const pathname = url.pathname.replaceAll(
      /\/(?<resource>mailfolders|messages|attachments)\('(?<id>[^']+)'\)/giu,
      (_match, name: string, id: string) =>
        `/${name}/${encodeURIComponent(decodeURIComponent(id))}`
    );
    const segments = pathname.split("/").slice(1);
    if (
      url.origin !== initial.origin ||
      url.username ||
      url.password ||
      url.hash ||
      segments.length !== resource.segments.length
    ) {
      throw new OutlookGraphError("invalid_response");
    }
    for (const [index, expected] of resource.segments.entries()) {
      const actual = segments[index];
      if (
        actual === undefined ||
        (typeof expected === "string"
          ? actual.toLowerCase() !== expected.toLowerCase()
          : decodeURIComponent(actual) !== expected.id)
      ) {
        throw new OutlookGraphError("invalid_response");
      }
    }
    for (const name of ["$filter", "$search"]) {
      const value = url.searchParams.get(name);
      if (value !== null && value !== resource.query?.[name]) {
        throw new OutlookGraphError("invalid_response");
      }
    }
  } catch {
    throw new OutlookGraphError("invalid_response");
  }
  return url;
};

const readResponseBytes = async (response: Response, maxBytes: number) => {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new OutlookGraphError("invalid_response");
  }
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return new Uint8Array();
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        throw new OutlookGraphError("invalid_response");
      }
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const requestGraph = async (
  context: OutlookReadContext,
  resource: Resource,
  continuation?: string
) => {
  context.signal?.throwIfAborted();
  const url = getReadUrl(resource, continuation);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Prefer: 'IdType="ImmutableId"',
        authorization: `Bearer ${context.accessToken}`,
      },
      redirect: "manual",
      signal: context.signal
        ? AbortSignal.any([context.signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
    });
  } catch {
    context.signal?.throwIfAborted();
    throw new OutlookGraphError("temporary");
  }
  if (!response.ok) {
    let providerCode: string | undefined;
    if (
      continuation !== undefined &&
      response.status >= 400 &&
      response.status < 500
    ) {
      try {
        const error = z
          .object({ error: z.object({ code: z.string().max(128) }) })
          .safeParse(
            JSON.parse(
              new TextDecoder().decode(await readResponseBytes(response, 8192))
            )
          );
        providerCode = error.success
          ? error.data.error.code.toLowerCase()
          : undefined;
      } catch {
        context.signal?.throwIfAborted();
      }
    } else {
      await response.body?.cancel();
    }
    const retryAfter = response.headers.get("retry-after");
    const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
    let timestamp = Date.parse(retryAfter ?? "");
    if (Number.isFinite(seconds)) {
      timestamp = seconds >= 0 ? Date.now() + seconds * 1000 : Number.NaN;
    }
    const retryAt = new Date(timestamp);
    const statusCodes = new Map<number, OutlookGraphErrorCode>([
      [401, "unauthorized"],
      [403, "forbidden"],
      [404, "not_found"],
      [410, "invalid_cursor"],
      [429, "rate_limited"],
    ]);
    const code =
      continuation !== undefined &&
      providerCode !== undefined &&
      [
        "syncstatenotfound",
        "errorinvalidsyncstatedata",
        "errorresyncrequired",
        "resyncrequired",
      ].includes(providerCode)
        ? "invalid_cursor"
        : (statusCodes.get(response.status) ??
          (response.status >= 500 ? "temporary" : "invalid_response"));
    throw new OutlookGraphError(code, {
      retryAt: Number.isNaN(retryAt.getTime()) ? undefined : retryAt,
      status: response.status,
    });
  }
  return response;
};

const readGraphJson = async <T>(
  context: OutlookReadContext,
  resource: Resource,
  schema: z.ZodType<T>,
  continuation?: string
): Promise<T> => {
  const response = await requestGraph(context, resource, continuation);
  let json: unknown;
  try {
    json = JSON.parse(
      new TextDecoder().decode(
        await readResponseBytes(response, 16 * 1024 * 1024)
      )
    );
  } catch {
    throw new OutlookGraphError("invalid_response");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new OutlookGraphError("invalid_response");
  }
  return parsed.data;
};

export const getOutlookProfile = async (context: OutlookReadContext) => {
  const profile = await readGraphJson(
    context,
    {
      query: { $select: "id,displayName,mail,userPrincipalName" },
      segments: ["v1.0", "me"],
    },
    z.object({
      displayName: z.string().nullish(),
      id: z.string().min(1),
      mail: z.string().nullish(),
      userPrincipalName: z.string().optional(),
    })
  );
  const email = z.email().safeParse(profile.mail ?? profile.userPrincipalName);
  if (!email.success) {
    throw new OutlookGraphError("unsupported");
  }
  return {
    displayName: profile.displayName ?? null,
    emailAddress: email.data,
    id: profile.id,
  };
};

export const listOutlookMailFolders = async (
  context: OutlookReadContext,
  input: { pageUrl?: string; parentFolderId?: string } = {}
): Promise<Page<OutlookFolder>> => {
  const resource: Resource = {
    query: { includeHiddenFolders: "true" },
    segments:
      input.parentFolderId === undefined
        ? ["v1.0", "me", "mailFolders"]
        : [
            "v1.0",
            "me",
            "mailFolders",
            { id: input.parentFolderId },
            "childFolders",
          ],
  };
  const page = await readGraphJson(
    context,
    resource,
    folderPageSchema,
    input.pageUrl
  );
  if (page["@odata.nextLink"] !== undefined) {
    getReadUrl(resource, page["@odata.nextLink"]);
  }
  return { nextPageUrl: page["@odata.nextLink"], values: page.value };
};

export const getOutlookSystemFolders = async (
  context: OutlookReadContext
): Promise<OutlookSystemFolders> => {
  const archive = await readGraphJson(
    context,
    { segments: ["v1.0", "me", "mailFolders", { id: "archive" }] },
    outlookFolderSchema
  );
  const drafts = await readGraphJson(
    context,
    { segments: ["v1.0", "me", "mailFolders", { id: "drafts" }] },
    outlookFolderSchema
  );
  const inbox = await readGraphJson(
    context,
    { segments: ["v1.0", "me", "mailFolders", { id: "inbox" }] },
    outlookFolderSchema
  );
  const sent = await readGraphJson(
    context,
    { segments: ["v1.0", "me", "mailFolders", { id: "sentitems" }] },
    outlookFolderSchema
  );
  const spam = await readGraphJson(
    context,
    { segments: ["v1.0", "me", "mailFolders", { id: "junkemail" }] },
    outlookFolderSchema
  );
  const trash = await readGraphJson(
    context,
    { segments: ["v1.0", "me", "mailFolders", { id: "deleteditems" }] },
    outlookFolderSchema
  );
  return {
    archive: archive.id,
    drafts: drafts.id,
    inbox: inbox.id,
    sent: sent.id,
    spam: spam.id,
    trash: trash.id,
  };
};

export type OutlookDeltaPage = {
  changes: (
    | { kind: "message"; message: OutlookMessagePatch }
    | { id: string; kind: "removed" }
  )[];
  continuation: { kind: "delta" | "next"; url: string };
};

export const getOutlookDeltaPage = async (
  context: OutlookReadContext,
  input: { cursor?: string; folderId: string }
): Promise<OutlookDeltaPage> => {
  const resource: Resource = {
    query: {
      $orderby: "receivedDateTime desc",
      $select: DELTA_FIELDS,
      $top: "50",
    },
    segments: [
      "v1.0",
      "me",
      "mailFolders",
      { id: input.folderId },
      "messages",
      "delta",
    ],
  };
  const page = await readGraphJson(
    context,
    resource,
    z.object({
      "@odata.deltaLink": z.string().optional(),
      "@odata.nextLink": z.string().optional(),
      value: z.array(
        z.union([
          z.object({
            "@removed": z.object({
              reason: z.enum(["deleted", "changed"]).optional(),
            }),
            id: z.string().min(1),
          }),
          outlookMessagePatchSchema.extend({
            "@removed": z.never().optional(),
          }),
        ])
      ),
    }),
    input.cursor
  );
  const next = page["@odata.nextLink"];
  const delta = page["@odata.deltaLink"];
  if ((next === undefined) === (delta === undefined)) {
    throw new OutlookGraphError("invalid_response");
  }
  const url = next ?? delta;
  if (url === undefined) {
    throw new OutlookGraphError("invalid_response");
  }
  getReadUrl(resource, url);
  const changes: OutlookDeltaPage["changes"] = page.value.map((message) => {
    if (message["@removed"] !== undefined) {
      return { id: message.id, kind: "removed" };
    }
    if (
      message.parentFolderId !== undefined &&
      message.parentFolderId !== input.folderId
    ) {
      throw new OutlookGraphError("invalid_response");
    }
    return { kind: "message", message };
  });
  return {
    changes,
    continuation: { kind: next === undefined ? "delta" : "next", url },
  };
};

export const getOutlookMessage = async (
  context: OutlookReadContext,
  input: { messageId: string }
): Promise<OutlookMessage> => {
  const message = await readGraphJson(
    context,
    {
      query: { $select: MESSAGE_FIELDS },
      segments: ["v1.0", "me", "messages", { id: input.messageId }],
    },
    outlookMessageSchema
  );
  if (message.id !== input.messageId) {
    throw new OutlookGraphError("invalid_response");
  }
  return message;
};

export const listOutlookConversationMessages = async (
  context: OutlookReadContext,
  input: { conversationId: string; pageUrl?: string }
): Promise<Page<OutlookMessage>> => {
  const resource: Resource = {
    query: {
      $filter: `conversationId eq '${input.conversationId.replaceAll("'", "''")}'`,
      $select: MESSAGE_FIELDS,
      $top: "50",
    },
    segments: ["v1.0", "me", "messages"],
  };
  const page = await readGraphJson(
    context,
    resource,
    messagePageSchema,
    input.pageUrl
  );
  if (
    page.value.some(
      (message) => message.conversationId !== input.conversationId
    )
  ) {
    throw new OutlookGraphError("invalid_response");
  }
  if (page["@odata.nextLink"] !== undefined) {
    getReadUrl(resource, page["@odata.nextLink"]);
  }
  return { nextPageUrl: page["@odata.nextLink"], values: page.value };
};

export const searchOutlookMessages = async (
  context: OutlookReadContext,
  input: { pageUrl?: string; query: string }
): Promise<Page<OutlookMessage>> => {
  const resource: Resource = {
    query: { $search: input.query, $select: MESSAGE_FIELDS, $top: "50" },
    segments: ["v1.0", "me", "messages"],
  };
  const page = await readGraphJson(
    context,
    resource,
    messagePageSchema,
    input.pageUrl
  );
  if (page["@odata.nextLink"] !== undefined) {
    getReadUrl(resource, page["@odata.nextLink"]);
  }
  return { nextPageUrl: page["@odata.nextLink"], values: page.value };
};

export const listOutlookAttachments = async (
  context: OutlookReadContext,
  input: { messageId: string; pageUrl?: string }
): Promise<Page<OutlookAttachment>> => {
  const resource: Resource = {
    query: {
      $select:
        "id,name,contentType,size,isInline,microsoft.graph.fileAttachment/contentId",
    },
    segments: [
      "v1.0",
      "me",
      "messages",
      { id: input.messageId },
      "attachments",
    ],
  };
  const page = await readGraphJson(
    context,
    resource,
    attachmentPageSchema,
    input.pageUrl
  );
  if (page["@odata.nextLink"] !== undefined) {
    getReadUrl(resource, page["@odata.nextLink"]);
  }
  return { nextPageUrl: page["@odata.nextLink"], values: page.value };
};

export const getOutlookAttachment = async (
  context: OutlookReadContext,
  input: { attachmentId: string; maxBytes?: number; messageId: string }
) => {
  const segments = [
    "v1.0",
    "me",
    "messages",
    { id: input.messageId },
    "attachments",
    { id: input.attachmentId },
  ];
  const attachment = await readGraphJson(
    context,
    {
      query: { $select: "id,name,contentType,size,isInline" },
      segments,
    },
    outlookAttachmentSchema
  );
  if (attachment.id !== input.attachmentId) {
    throw new OutlookGraphError("invalid_response");
  }
  if (attachment["@odata.type"] === "#microsoft.graph.referenceAttachment") {
    throw new OutlookGraphError("unsupported");
  }
  const maxBytes = input.maxBytes ?? 25 * 1024 * 1024;
  if (attachment.size > maxBytes) {
    throw new OutlookGraphError("unsupported");
  }
  const response = await requestGraph(context, {
    segments: [...segments, "$value"],
  });
  const bytes = await readResponseBytes(response, maxBytes);
  return {
    attachment,
    bytes,
    contentType:
      response.headers.get("content-type") ??
      attachment.contentType ??
      "application/octet-stream",
  };
};
