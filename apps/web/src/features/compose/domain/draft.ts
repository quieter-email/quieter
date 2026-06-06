import type { ComposeDraftAnchor } from "@quieter/mail/compose";
import { rpc } from "~/lib/orpc";

const MAX_TOTAL_ATTACHMENT_BYTES = 24 * 1024 * 1024;
const CONTENT_ID_PREFIX = "quieter-inline";

type ComposeSaveStatus = "idle" | "saving" | "saved" | "error" | "sending";

type ComposeRecipientFields = {
  to: string;
  cc: string;
  bcc: string;
};

export type ComposeReplyContext = {
  threadId: string;
  messageHeaderId?: string;
  references: string[];
};

type ComposeAssetBase = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  gmailAttachmentId?: string;
};

type ComposeAttachment = ComposeAssetBase & {
  isInline: false;
};

type ComposeInlineImage = ComposeAssetBase & {
  contentId: string;
  isInline: true;
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

type RuntimeBinary = {
  file: File;
  objectUrl: string;
};

const runtimeBinaryById = new Map<string, RuntimeBinary>();

const normalizeString = (value: string): string => value.replaceAll(/\u200B/g, "").trim();

export const createEmptyComposeDraft = (): ComposeDraftState => ({
  localId: crypto.randomUUID(),
  draftAnchor: null,
  replyContext: null,
  recipients: {
    to: "",
    cc: "",
    bcc: "",
  },
  subject: "",
  bodyHtml: "",
  bodyText: "",
  attachments: [],
  inlineImages: [],
  saveStatus: "idle",
  errorMessage: null,
  updatedAt: Date.now(),
});

export const cloneComposeDraft = (draft: ComposeDraftState): ComposeDraftState => ({
  ...draft,
  draftAnchor: draft.draftAnchor && { ...draft.draftAnchor },
  replyContext: draft.replyContext && {
    ...draft.replyContext,
    references: [...draft.replyContext.references],
  },
  recipients: { ...draft.recipients },
  attachments: draft.attachments.map((attachment) => ({ ...attachment })),
  inlineImages: draft.inlineImages.map((image) => ({ ...image })),
});

const areReplyContextsEqual = (
  left: ComposeReplyContext | null | undefined,
  right: ComposeReplyContext | null | undefined,
) => {
  if (!left && !right) return true;
  if (!left || !right) return false;
  if (left.references.length !== right.references.length) return false;

  for (const [index, reference] of left.references.entries()) {
    if (reference !== right.references[index]) return false;
  }

  return left.threadId === right.threadId && left.messageHeaderId === right.messageHeaderId;
};

const areDraftAnchorsEqual = (
  left: ComposeDraftAnchor | null | undefined,
  right: ComposeDraftAnchor | null | undefined,
) => {
  if (!left && !right) return true;
  if (!left || !right) return false;

  return (
    left.sourceMessageId === right.sourceMessageId &&
    left.sourceThreadId === right.sourceThreadId &&
    left.sourceMessageHeaderId === right.sourceMessageHeaderId &&
    left.seededBy === right.seededBy
  );
};

const areComposeAssetsEqual = (
  left: readonly (ComposeAttachment | ComposeInlineImage)[],
  right: readonly (ComposeAttachment | ComposeInlineImage)[],
) => {
  if (left.length !== right.length) return false;

  for (const [index, attachment] of left.entries()) {
    const other = right[index];
    if (!other) return false;

    if (
      attachment.id === other.id &&
      attachment.name === other.name &&
      attachment.mimeType === other.mimeType &&
      attachment.size === other.size &&
      attachment.gmailAttachmentId === other.gmailAttachmentId &&
      attachment.isInline === other.isInline &&
      ("contentId" in attachment
        ? "contentId" in other && attachment.contentId === other.contentId
        : !("contentId" in other))
    ) {
      continue;
    }

    return false;
  }

  return true;
};

export const haveComposeDraftPersistedFieldsChanged = (
  current: ComposeDraftState,
  next: ComposeDraftState,
) => {
  return !(
    areDraftAnchorsEqual(current.draftAnchor, next.draftAnchor) &&
    areReplyContextsEqual(current.replyContext, next.replyContext) &&
    current.recipients.to === next.recipients.to &&
    current.recipients.cc === next.recipients.cc &&
    current.recipients.bcc === next.recipients.bcc &&
    current.subject === next.subject &&
    current.bodyHtml === next.bodyHtml &&
    current.bodyText === next.bodyText &&
    areComposeAssetsEqual(current.attachments, next.attachments) &&
    areComposeAssetsEqual(current.inlineImages, next.inlineImages)
  );
};

const revokeRuntimeBinary = (id: string) => {
  const runtime = runtimeBinaryById.get(id);
  if (!runtime) return;
  URL.revokeObjectURL(runtime.objectUrl);
  runtimeBinaryById.delete(id);
};

export const removeComposeRuntimeFile = (id: string) => {
  revokeRuntimeBinary(id);
};

const getComposeRuntimeObjectUrl = (id: string): string | undefined =>
  runtimeBinaryById.get(id)?.objectUrl;

const rememberRuntimeFile = (id: string, file: File) => {
  revokeRuntimeBinary(id);
  runtimeBinaryById.set(id, {
    file,
    objectUrl: URL.createObjectURL(file),
  });
};

export const clearComposeDraftRuntimeFiles = (draft: ComposeDraftState) => {
  for (const asset of [...draft.attachments, ...draft.inlineImages]) {
    revokeRuntimeBinary(asset.id);
  }
};

const htmlToText = (html: string): string => {
  if (!html) return "";
  if (typeof window === "undefined") {
    return html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent?.replace(/\s+\n/g, "\n").trim() ?? "";
};

export const escapeComposeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const textToComposeBodyHtml = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) return "";

  return normalized
    .split(/\r?\n(?:\r?\n)+/g)
    .map(
      (paragraph) =>
        `<p>${paragraph
          .split(/\r?\n/g)
          .map((line) => (line ? escapeComposeHtml(line) : "<br>"))
          .join("<br>")}</p>`,
    )
    .join("");
};

const hasMeaningfulBodyHtml = (bodyHtml: string): boolean => {
  const normalizedHtml = bodyHtml.trim();
  if (!normalizedHtml) return false;

  if (typeof window === "undefined") {
    return /<(img|video|audio|iframe)\b/i.test(normalizedHtml);
  }

  const doc = new DOMParser().parseFromString(normalizedHtml, "text/html");
  return !!doc.body.querySelector("img,video,audio,iframe");
};

export const normalizeComposeBodyHtml = (bodyHtml: string): string => {
  const normalizedHtml = bodyHtml.trim();
  if (!normalizedHtml) return "";

  if (normalizeString(htmlToText(normalizedHtml))) {
    return normalizedHtml;
  }

  return hasMeaningfulBodyHtml(normalizedHtml) ? normalizedHtml : "";
};

export const getRenderableComposeBodyHtml = (bodyHtml: string, bodyText: string): string =>
  normalizeComposeBodyHtml(bodyHtml) || textToComposeBodyHtml(bodyText);

export const hasComposeDraftContent = (draft: ComposeDraftState): boolean => {
  return !!(
    normalizeString(draft.recipients.to) ||
    normalizeString(draft.recipients.cc) ||
    normalizeString(draft.recipients.bcc) ||
    normalizeString(draft.subject) ||
    normalizeComposeBodyHtml(draft.bodyHtml) ||
    normalizeString(draft.bodyText) ||
    draft.attachments.length > 0 ||
    draft.inlineImages.length > 0
  );
};

const attachRuntimeFile = <T extends ComposeAttachment | ComposeInlineImage>(asset: T) => {
  const runtimeFile = runtimeBinaryById.get(asset.id)?.file;
  if (!runtimeFile) {
    throw new Error(`Missing file payload for ${asset.name}.`);
  }

  return {
    ...asset,
    file: runtimeFile,
  };
};

type CreateComposeAssetOptions = {
  gmailAttachmentId?: string;
  id?: string;
};

const createComposeAssetBase = (file: File, options: CreateComposeAssetOptions = {}) => {
  const id = options.id ?? crypto.randomUUID();
  rememberRuntimeFile(id, file);

  return {
    id,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    gmailAttachmentId: options.gmailAttachmentId,
  };
};

const createComposeInlineImageFromFile = (
  file: File,
  options?: CreateComposeAssetOptions & { contentId?: string },
): ComposeInlineImage => {
  const asset = createComposeAssetBase(file, options);

  return {
    ...asset,
    contentId: options?.contentId ?? `${CONTENT_ID_PREFIX}-${asset.id}`,
    isInline: true,
  };
};

export const createComposeInlineImagesFromFiles = async (files: FileList | File[]) =>
  Array.from(files, (file) => createComposeInlineImageFromFile(file));

const assertAttachmentBudget = (draft: ComposeDraftState) => {
  const totalSize =
    draft.attachments.reduce((sum, attachment) => sum + attachment.size, 0) +
    draft.inlineImages.reduce((sum, image) => sum + image.size, 0);

  if (totalSize > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new Error("Attachments exceed the 24MB compose limit.");
  }
};

const findReferencedInlineImageIds = (html: string): Set<string> => {
  if (!html || typeof window === "undefined") return new Set();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const ids = new Set<string>();

  for (const image of Array.from(doc.querySelectorAll("img[data-compose-inline-id]"))) {
    const imageId = image.getAttribute("data-compose-inline-id");
    if (imageId) ids.add(imageId);
  }

  return ids;
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
    updatedAt: Date.now(),
  };
};

const serializeDraft = async (draft: ComposeDraftState) => {
  assertAttachmentBudget(draft);
  const inlineImages = draft.inlineImages.map((image) => attachRuntimeFile(image));
  const attachments = draft.attachments.map((attachment) => attachRuntimeFile(attachment));

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
  const bodyHtml = getRenderableComposeBodyHtml(response.bodyHtml, response.bodyText);

  return {
    ...draft,
    draftId: response.draftId,
    draftAnchor: response.draftAnchor ?? null,
    messageId: response.messageId ?? undefined,
    bodyHtml,
    bodyText: response.bodyText || htmlToText(bodyHtml),
    subject: response.subject,
    recipients: response.recipients,
    replyContext: response.replyContext ?? null,
    saveStatus: "saved",
    errorMessage: null,
    lastSavedAt: Date.now(),
    updatedAt: Date.now(),
  };
};

export const sendComposeMessage = async (
  mailboxId: string,
  draft: ComposeDraftState,
  signal?: AbortSignal,
) => {
  return rpc.mail.sendMessage({ mailboxId, message: await serializeDraft(draft) }, { signal });
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
  if (typeof window === "undefined") return draft.bodyHtml;

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
