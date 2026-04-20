import type { ComposeDraftAnchor } from "@quietr/orpc/compose";
import { findInvalidMailAddresses } from "@quietr/orpc/compose";
import { loadAttachmentFromServer } from "~/lib/gmail/attachments";
import { rpc } from "~/lib/orpc";
export { loadAttachmentFromServer } from "~/lib/gmail/attachments";

const MAX_TOTAL_ATTACHMENT_BYTES = 24 * 1024 * 1024;
const MAX_VISIBLE_INLINE_DRAFTS = 2;
const CONTENT_ID_PREFIX = "quietr-inline";

export type ComposeSaveStatus = "idle" | "saving" | "saved" | "error" | "sending" | "discarding";

export type ComposeRecipientFields = {
  to: string;
  cc: string;
  bcc: string;
};

export type ComposeReplyContext = {
  threadId: string;
  messageHeaderId?: string;
  references: string[];
};

export type ComposeAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  gmailAttachmentId?: string;
  isInline: boolean;
};

export type ComposeInlineImage = ComposeAttachment & {
  contentId: string;
};

type DraftAttachmentPayload = {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  size: number;
};

type DraftInlineImagePayload = DraftAttachmentPayload & {
  contentId: string;
};

export type ComposeDraftState = {
  localId: string;
  draftId?: string;
  messageId?: string;
  draftAnchor?: ComposeDraftAnchor | null;
  replyContext?: ComposeReplyContext | null;
  recipients: ComposeRecipientFields;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  attachments: ComposeAttachment[];
  inlineImages: ComposeInlineImage[];
  saveStatus: ComposeSaveStatus;
  errorMessage: string | null;
  lastSavedAt?: number;
  updatedAt: number;
};

export type ComposeSessionState = {
  activeDraft: ComposeDraftState;
  lastDraft: ComposeDraftState | null;
};

type RuntimeBinary = {
  file: File;
  objectUrl: string;
};

const runtimeBinaryById = new Map<string, RuntimeBinary>();
const isBrowser = typeof window !== "undefined";

const createLocalId = () => crypto.randomUUID();
const now = () => Date.now();

const normalizeString = (value: string): string => value.replaceAll(/\u200B/g, "").trim();

const createEmptyRecipients = (): ComposeRecipientFields => ({
  to: "",
  cc: "",
  bcc: "",
});

export const createEmptyComposeDraft = (): ComposeDraftState => ({
  localId: createLocalId(),
  draftAnchor: null,
  replyContext: null,
  recipients: createEmptyRecipients(),
  subject: "",
  bodyHtml: "",
  bodyText: "",
  attachments: [],
  inlineImages: [],
  saveStatus: "idle",
  errorMessage: null,
  updatedAt: now(),
});

export const createInitialComposeSessionState = (): ComposeSessionState => ({
  activeDraft: createEmptyComposeDraft(),
  lastDraft: null,
});

const cloneAttachment = <T extends ComposeAttachment | ComposeInlineImage>(attachment: T): T =>
  ({ ...attachment }) as T;

export const cloneComposeDraft = (draft: ComposeDraftState): ComposeDraftState => ({
  ...draft,
  draftAnchor: draft.draftAnchor ? { ...draft.draftAnchor } : null,
  replyContext: draft.replyContext
    ? {
        ...draft.replyContext,
        references: [...draft.replyContext.references],
      }
    : null,
  recipients: { ...draft.recipients },
  attachments: draft.attachments.map((attachment) => cloneAttachment(attachment)),
  inlineImages: draft.inlineImages.map((image) => cloneAttachment(image)),
});

export const cloneComposeSessionState = (session: ComposeSessionState): ComposeSessionState => ({
  activeDraft: cloneComposeDraft(session.activeDraft),
  lastDraft: session.lastDraft ? cloneComposeDraft(session.lastDraft) : null,
});

const revokeRuntimeBinary = (id: string) => {
  const runtime = runtimeBinaryById.get(id);
  if (!runtime) return;
  URL.revokeObjectURL(runtime.objectUrl);
  runtimeBinaryById.delete(id);
};

export const removeComposeRuntimeFile = (id: string) => {
  revokeRuntimeBinary(id);
};

export const getComposeRuntimeFile = (id: string): File | undefined =>
  runtimeBinaryById.get(id)?.file;

export const getComposeRuntimeObjectUrl = (id: string): string | undefined =>
  runtimeBinaryById.get(id)?.objectUrl;

const rememberRuntimeFile = (id: string, file: File) => {
  revokeRuntimeBinary(id);
  runtimeBinaryById.set(id, {
    file,
    objectUrl: URL.createObjectURL(file),
  });
};

export const clearComposeDraftRuntimeFiles = (draft: ComposeDraftState) => {
  for (const attachment of draft.attachments) {
    revokeRuntimeBinary(attachment.id);
  }

  for (const image of draft.inlineImages) {
    revokeRuntimeBinary(image.id);
  }
};

export const validateRecipientInput = (value: string): string[] => findInvalidMailAddresses(value);

const htmlToText = (html: string): string => {
  if (!html) return "";
  if (!isBrowser) {
    return html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent?.replace(/\s+\n/g, "\n").trim() ?? "";
};

const hasMeaningfulBodyHtml = (bodyHtml: string): boolean => {
  const normalizedHtml = bodyHtml.trim();
  if (!normalizedHtml) return false;

  if (!isBrowser) {
    return /<(img|video|audio|iframe)\b/i.test(normalizedHtml);
  }

  const doc = new DOMParser().parseFromString(normalizedHtml, "text/html");
  return Boolean(doc.body.querySelector("img,video,audio,iframe"));
};

export const normalizeComposeBodyHtml = (bodyHtml: string, bodyText?: string): string => {
  const normalizedHtml = bodyHtml.trim();
  if (!normalizedHtml) return "";

  if (normalizeString(bodyText ?? htmlToText(normalizedHtml))) {
    return normalizedHtml;
  }

  return hasMeaningfulBodyHtml(normalizedHtml) ? normalizedHtml : "";
};

export const hasComposeDraftContent = (draft: ComposeDraftState): boolean => {
  return Boolean(
    normalizeString(draft.recipients.to) ||
    normalizeString(draft.recipients.cc) ||
    normalizeString(draft.recipients.bcc) ||
    normalizeString(draft.subject) ||
    normalizeComposeBodyHtml(draft.bodyHtml, draft.bodyText) ||
    draft.attachments.length > 0 ||
    draft.inlineImages.length > 0,
  );
};

const attachRuntimeFile = <T extends ComposeAttachment | ComposeInlineImage>(asset: T) => {
  const runtimeFile = getComposeRuntimeFile(asset.id);
  if (!runtimeFile) {
    throw new Error(`Missing file payload for ${asset.name}.`);
  }

  return {
    ...asset,
    file: runtimeFile,
  };
};

const createInlineImageFromFile = (
  file: File,
  options?: { contentId?: string; gmailAttachmentId?: string; id?: string },
): ComposeInlineImage => {
  const id = options?.id ?? createLocalId();
  rememberRuntimeFile(id, file);
  return {
    id,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    contentId: options?.contentId ?? `${CONTENT_ID_PREFIX}-${id}`,
    gmailAttachmentId: options?.gmailAttachmentId,
    isInline: true,
  };
};

const createAttachmentFromFile = (
  file: File,
  options?: { gmailAttachmentId?: string; id?: string },
): ComposeAttachment => {
  const id = options?.id ?? createLocalId();
  rememberRuntimeFile(id, file);
  return {
    id,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    gmailAttachmentId: options?.gmailAttachmentId,
    isInline: false,
  };
};

export const createComposeAttachmentsFromFiles = async (files: FileList | File[]) =>
  Array.from(files, (file) => createAttachmentFromFile(file));

export const createComposeInlineImagesFromFiles = async (files: FileList | File[]) =>
  Array.from(files, (file) => createInlineImageFromFile(file));

const assertAttachmentBudget = (draft: ComposeDraftState) => {
  const totalSize =
    draft.attachments.reduce((sum, attachment) => sum + attachment.size, 0) +
    draft.inlineImages.reduce((sum, image) => sum + image.size, 0);

  if (totalSize > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new Error("Attachments exceed the 24MB compose limit.");
  }
};

const parseDraftResponse = (response: {
  draftId: string;
  draftAnchor?: ComposeDraftAnchor | null;
  messageId?: string | null;
  bodyHtml: string;
  bodyText: string;
  subject: string;
  recipients: ComposeRecipientFields;
  replyContext?: ComposeReplyContext | null;
}) => ({
  draftId: response.draftId,
  draftAnchor: response.draftAnchor ?? null,
  messageId: response.messageId ?? undefined,
  bodyHtml: response.bodyHtml,
  bodyText: response.bodyText,
  subject: response.subject,
  recipients: response.recipients,
  replyContext: response.replyContext ?? null,
});

const findReferencedInlineImageIds = (html: string): Set<string> => {
  if (!html || !isBrowser) return new Set();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const ids = new Set<string>();

  for (const image of Array.from(doc.querySelectorAll("img[data-compose-inline-id]"))) {
    const imageId = image.getAttribute("data-compose-inline-id");
    if (imageId) ids.add(imageId);
  }

  return ids;
};

const updateInlineImageHtml = (
  html: string,
  inlineImages: readonly ComposeInlineImage[],
): string => {
  if (!html || !isBrowser) return html;

  const inlineImageById = new Map(inlineImages.map((image) => [image.id, image] as const));
  const inlineImageByContentId = new Map(
    inlineImages.map((image) => [
      image.contentId.trim().replace(/^<|>$/g, "").toLowerCase(),
      image,
    ]),
  );
  const doc = new DOMParser().parseFromString(html, "text/html");

  for (const image of Array.from(doc.querySelectorAll("img"))) {
    const imageId = image.getAttribute("data-compose-inline-id");
    const cidSource = image.getAttribute("src") ?? "";
    const cidMatch = cidSource.match(/^cid:(.+)$/i);
    const normalizedContentId = cidMatch?.[1]?.trim().replace(/^<|>$/g, "").toLowerCase();
    const asset = imageId
      ? inlineImageById.get(imageId)
      : normalizedContentId
        ? inlineImageByContentId.get(normalizedContentId)
        : undefined;
    if (!asset) continue;
    const objectUrl = getComposeRuntimeObjectUrl(asset.id);
    if (objectUrl) {
      image.setAttribute("src", objectUrl);
      image.setAttribute("data-compose-inline-id", asset.id);
    }
  }

  return doc.body.innerHTML.trim();
};

const hydrateDraftAttachment = async (
  mailboxId: string,
  messageId: string,
  attachment: DraftAttachmentPayload,
  signal?: AbortSignal,
) => {
  const file = await loadAttachmentFromServer(
    mailboxId,
    messageId,
    attachment.attachmentId,
    attachment.fileName,
    attachment.mimeType,
    signal,
  );

  return createAttachmentFromFile(file, {
    gmailAttachmentId: attachment.attachmentId,
  });
};

const hydrateDraftInlineImage = async (
  mailboxId: string,
  messageId: string,
  inlineImage: DraftInlineImagePayload,
  signal?: AbortSignal,
) => {
  const file = await loadAttachmentFromServer(
    mailboxId,
    messageId,
    inlineImage.attachmentId,
    inlineImage.fileName,
    inlineImage.mimeType,
    signal,
  );

  return createInlineImageFromFile(file, {
    contentId: inlineImage.contentId,
    gmailAttachmentId: inlineImage.attachmentId,
  });
};

export const hydrateComposeDraftRuntime = async (
  mailboxId: string,
  draft: ComposeDraftState,
  signal?: AbortSignal,
): Promise<ComposeDraftState> => {
  if (!draft.draftId) return draft;

  const response = await rpc.mail.loadDraft({ mailboxId, draftId: draft.draftId }, { signal });
  const attachments =
    response.messageId && response.attachments.length > 0
      ? await Promise.all(
          response.attachments.map(
            async (attachment) =>
              await hydrateDraftAttachment(mailboxId, response.messageId!, attachment, signal),
          ),
        )
      : [];
  const inlineImages =
    response.messageId && response.inlineImages.length > 0
      ? await Promise.all(
          response.inlineImages.map(
            async (inlineImage) =>
              await hydrateDraftInlineImage(mailboxId, response.messageId!, inlineImage, signal),
          ),
        )
      : [];

  return {
    ...draft,
    draftAnchor: response.draftAnchor ?? draft.draftAnchor ?? null,
    messageId: response.messageId ?? draft.messageId,
    replyContext: response.replyContext ?? draft.replyContext ?? null,
    recipients: response.recipients,
    subject: response.subject,
    attachments,
    inlineImages,
    bodyHtml: updateInlineImageHtml(
      response.bodyHtml,
      inlineImages.slice(0, MAX_VISIBLE_INLINE_DRAFTS),
    ),
    bodyText: response.bodyText || htmlToText(response.bodyHtml),
    saveStatus: "saved",
    errorMessage: null,
    lastSavedAt: now(),
    updatedAt: now(),
  };
};

export const syncInlineImagesWithHtml = (
  draft: ComposeDraftState,
  bodyHtml: string,
): ComposeDraftState => {
  const referencedIds = findReferencedInlineImageIds(bodyHtml);
  const nextInlineImages = draft.inlineImages.filter((image) => referencedIds.has(image.id));

  return {
    ...draft,
    bodyHtml,
    bodyText: htmlToText(bodyHtml),
    inlineImages: nextInlineImages,
    updatedAt: now(),
  };
};

const serializeDraft = async (draft: ComposeDraftState) => {
  assertAttachmentBudget(draft);
  const inlineImages = draft.inlineImages.map((image) => attachRuntimeFile(image));
  const attachments = draft.attachments
    .filter((attachment) => !attachment.isInline)
    .map((attachment) => attachRuntimeFile(attachment));

  return {
    ...draft,
    attachments,
    inlineImages,
  };
};

export const saveComposeDraft = async (
  mailboxId: string,
  draft: ComposeDraftState,
  signal?: AbortSignal,
): Promise<ComposeDraftState> => {
  const response = await rpc.mail.saveDraft(
    { mailboxId, draft: await serializeDraft(draft) },
    { signal },
  );
  const metadata = parseDraftResponse(response);

  return {
    ...draft,
    ...metadata,
    saveStatus: "saved",
    errorMessage: null,
    lastSavedAt: now(),
    updatedAt: now(),
  };
};

export const sendComposeDraft = async (
  mailboxId: string,
  draft: ComposeDraftState,
  signal?: AbortSignal,
) => {
  return await rpc.mail.sendDraft({ mailboxId, draft: await serializeDraft(draft) }, { signal });
};

export const deleteComposeDraft = async (
  mailboxId: string,
  draft: ComposeDraftState,
  signal?: AbortSignal,
) => {
  if (!draft.draftId) return;
  await rpc.mail.deleteDraft({ mailboxId, draftId: draft.draftId }, { signal });
};

export const attachInlineImagesToHtml = (
  draft: ComposeDraftState,
  images: ComposeInlineImage[],
): string => {
  if (!isBrowser) return draft.bodyHtml;

  const doc = new DOMParser().parseFromString(draft.bodyHtml || "<p></p>", "text/html");
  const body = doc.body;

  if (body.innerHTML.trim().length === 0) {
    body.innerHTML = "<p></p>";
  }

  for (const image of images) {
    const paragraph = doc.createElement("p");
    const element = doc.createElement("img");
    const objectUrl = getComposeRuntimeObjectUrl(image.id);
    if (!objectUrl) continue;

    element.setAttribute("src", objectUrl);
    element.setAttribute("alt", image.name);
    element.setAttribute("data-compose-inline-id", image.id);
    paragraph.appendChild(element);
    body.appendChild(paragraph);
  }

  return body.innerHTML.trim();
};

export const buildFreshActiveComposeSession = (
  session: ComposeSessionState,
): ComposeSessionState => {
  const activeDraft = cloneComposeDraft(session.activeDraft);
  const nextLastDraft = hasComposeDraftContent(activeDraft) ? activeDraft : session.lastDraft;

  return {
    activeDraft: createEmptyComposeDraft(),
    lastDraft: nextLastDraft ? cloneComposeDraft(nextLastDraft) : null,
  };
};

export const swapComposeDrafts = (session: ComposeSessionState): ComposeSessionState => {
  if (!session.lastDraft) return session;

  return {
    activeDraft: cloneComposeDraft(session.lastDraft),
    lastDraft: cloneComposeDraft(session.activeDraft),
  };
};
