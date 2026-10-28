import { rpc } from "@quieter/app/lib/orpc";
import type { ComposeDraftAnchor } from "@quieter/mail/compose/schema";

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
  sourceMessageId?: string;
};

type ComposeAttachment = ComposeAssetBase & {
  isInline: false;
};

type ComposeInlineImage = ComposeAssetBase & {
  contentId: string;
  isInline: true;
};

export type ComposeDraftState = {
  assistantUnsaved?: boolean;
  localId: string;
  baseRevision?: string;
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
  sendOperationId?: string;
  sendUncertain?: boolean;
  senderName?: string;
  errorMessage: string | null;
  lastSavedAt?: number;
  recoveryEditorId?: string;
  recoveryLocalId?: string;
  recoveryMissingFiles?: string[];
  recoveryUpdatedAt?: number;
  updatedAt: number;
};

type RuntimeBinary = {
  file: File;
  objectUrl: string;
};

const runtimeBinaryById = new Map<string, RuntimeBinary>();
const pendingRuntimeFiles = new Map<string, { removed: boolean }>();

const normalizeString = (value: string): string =>
  value.replaceAll("​", "").trim();

export const createEmptyComposeDraft = (): ComposeDraftState => ({
  attachments: [],
  bodyHtml: "",
  bodyText: "",
  draftAnchor: null,
  errorMessage: null,
  inlineImages: [],
  localId: crypto.randomUUID(),
  recipients: {
    bcc: "",
    cc: "",
    to: "",
  },
  replyContext: null,
  saveStatus: "idle",
  subject: "",
  updatedAt: Date.now(),
});

export const cloneComposeDraft = (
  draft: ComposeDraftState
): ComposeDraftState => ({
  ...draft,
  attachments: draft.attachments.map((attachment) => ({ ...attachment })),
  draftAnchor: draft.draftAnchor && { ...draft.draftAnchor },
  inlineImages: draft.inlineImages.map((image) => ({ ...image })),
  recipients: { ...draft.recipients },
  replyContext: draft.replyContext && {
    ...draft.replyContext,
    references: [...draft.replyContext.references],
  },
});

const areReplyContextsEqual = (
  left: ComposeReplyContext | null | undefined,
  right: ComposeReplyContext | null | undefined
) => {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  if (left.references.length !== right.references.length) {
    return false;
  }

  for (const [index, reference] of left.references.entries()) {
    if (reference !== right.references[index]) {
      return false;
    }
  }

  return (
    left.threadId === right.threadId &&
    left.messageHeaderId === right.messageHeaderId
  );
};

const areDraftAnchorsEqual = (
  left: ComposeDraftAnchor | null | undefined,
  right: ComposeDraftAnchor | null | undefined
) => {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  return (
    left.sourceMessageId === right.sourceMessageId &&
    left.sourceThreadId === right.sourceThreadId &&
    left.sourceMessageHeaderId === right.sourceMessageHeaderId &&
    left.seededBy === right.seededBy
  );
};

const areComposeAssetsEqual = (
  left: readonly (ComposeAttachment | ComposeInlineImage)[],
  right: readonly (ComposeAttachment | ComposeInlineImage)[]
) => {
  if (left.length !== right.length) {
    return false;
  }

  for (const [index, attachment] of left.entries()) {
    const other = right[index];
    if (other === undefined) {
      return false;
    }

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
  next: ComposeDraftState
) =>
  !(
    areDraftAnchorsEqual(current.draftAnchor, next.draftAnchor) &&
    areReplyContextsEqual(current.replyContext, next.replyContext) &&
    current.recipients.to === next.recipients.to &&
    current.recipients.cc === next.recipients.cc &&
    current.recipients.bcc === next.recipients.bcc &&
    current.subject === next.subject &&
    (current.senderName?.trim() ?? "") === (next.senderName?.trim() ?? "") &&
    current.bodyHtml === next.bodyHtml &&
    current.bodyText === next.bodyText &&
    areComposeAssetsEqual(current.attachments, next.attachments) &&
    areComposeAssetsEqual(current.inlineImages, next.inlineImages)
  );

const revokeRuntimeBinary = (id: string) => {
  const runtime = runtimeBinaryById.get(id);
  if (!runtime) {
    return;
  }
  URL.revokeObjectURL(runtime.objectUrl);
  runtimeBinaryById.delete(id);
};

export const removeComposeRuntimeFile = (id: string) => {
  const pending = pendingRuntimeFiles.get(id);
  if (pending) {
    pending.removed = true;
  }
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

export const cloneComposeDraftRuntimeFiles = (
  draft: ComposeDraftState
): ComposeDraftState => {
  const assets = [...draft.attachments, ...draft.inlineImages];
  for (const asset of assets) {
    if (!runtimeBinaryById.has(asset.id)) {
      throw new Error(
        `Reattach ${asset.name} before changing the sending address.`
      );
    }
  }
  const copies = new Map<string, { id: string; objectUrl: string }>();
  for (const asset of assets) {
    const runtime = runtimeBinaryById.get(asset.id);
    if (runtime) {
      const id = crypto.randomUUID();
      const objectUrl = URL.createObjectURL(runtime.file);
      runtimeBinaryById.set(id, { file: runtime.file, objectUrl });
      copies.set(asset.id, { id, objectUrl });
    }
  }
  const doc = new DOMParser().parseFromString(draft.bodyHtml, "text/html");
  for (const element of doc.querySelectorAll<HTMLImageElement>("img")) {
    const image = draft.inlineImages.find(
      (asset) =>
        asset.id === element.dataset.composeInlineId ||
        element.getAttribute("src")?.toLowerCase() ===
          `cid:${asset.contentId.toLowerCase()}`
    );
    const copy = image === undefined ? undefined : copies.get(image.id);
    if (copy) {
      element.setAttribute("src", copy.objectUrl);
      element.dataset.composeInlineId = copy.id;
    }
  }
  return {
    ...draft,
    attachments: draft.attachments.map((asset) => {
      const copy = copies.get(asset.id);
      if (!copy) {
        throw new Error("The draft files could not be copied.");
      }
      return {
        ...asset,
        gmailAttachmentId: undefined,
        id: copy.id,
        sourceMessageId: undefined,
      };
    }),
    bodyHtml: doc.body.innerHTML,
    inlineImages: draft.inlineImages.map((asset) => {
      const copy = copies.get(asset.id);
      if (!copy) {
        throw new Error("The draft images could not be copied.");
      }
      return {
        ...asset,
        contentId: `${CONTENT_ID_PREFIX}-${copy.id}`,
        gmailAttachmentId: undefined,
        id: copy.id,
        sourceMessageId: undefined,
      };
    }),
  };
};

export const clearComposeDraftRuntimeFiles = (draft: ComposeDraftState) => {
  for (const asset of [...draft.attachments, ...draft.inlineImages]) {
    removeComposeRuntimeFile(asset.id);
  }
};

export const createRecoveredComposeCopy = (
  draft: ComposeDraftState
): ComposeDraftState => {
  if (draft.sendUncertain === true) {
    throw new Error("Check delivery before recovering this message as a copy.");
  }
  const missing = [...draft.attachments, ...draft.inlineImages].filter(
    (asset) => !runtimeBinaryById.has(asset.id)
  );
  const recoveryMissingFiles = [
    ...new Set([
      ...(draft.recoveryMissingFiles ?? []),
      ...missing.map((asset) => asset.name),
    ]),
  ];
  const doc = new DOMParser().parseFromString(draft.bodyHtml, "text/html");
  for (const element of doc.querySelectorAll<HTMLImageElement>("img")) {
    const image = draft.inlineImages.find(
      (asset) =>
        asset.id === element.dataset.composeInlineId ||
        asset.contentId ===
          `${CONTENT_ID_PREFIX}-${element.dataset.composeInlineId ?? ""}` ||
        element.getAttribute("src")?.toLowerCase() ===
          `cid:${asset.contentId.toLowerCase()}`
    );
    if (image && !runtimeBinaryById.has(image.id)) {
      element.remove();
    } else if (image) {
      const runtime = runtimeBinaryById.get(image.id);
      if (runtime) {
        element.setAttribute("src", runtime.objectUrl);
        element.dataset.composeInlineId = image.id;
      }
    }
  }
  return {
    ...draft,
    attachments: draft.attachments
      .filter((asset) => runtimeBinaryById.has(asset.id))
      .map((asset) => ({
        ...asset,
        gmailAttachmentId: undefined,
        sourceMessageId: undefined,
      })),
    baseRevision: undefined,
    bodyHtml: doc.body.innerHTML,
    draftId: undefined,
    errorMessage:
      recoveryMissingFiles.length > 0
        ? `Your text was recovered. Reattach these files before sending: ${recoveryMissingFiles.join(", ")}.`
        : draft.errorMessage,
    inlineImages: draft.inlineImages
      .filter((asset) => runtimeBinaryById.has(asset.id))
      .map((asset) => ({
        ...asset,
        gmailAttachmentId: undefined,
        sourceMessageId: undefined,
      })),
    lastSavedAt: undefined,
    localId: crypto.randomUUID(),
    messageId: undefined,
    recoveryLocalId: draft.recoveryLocalId ?? draft.localId,
    recoveryMissingFiles,
    saveStatus:
      recoveryMissingFiles.length > 0 || draft.errorMessage !== null
        ? "error"
        : "idle",
    sendOperationId: crypto.randomUUID(),
    sendUncertain: false,
    updatedAt: Date.now(),
  };
};

const htmlToText = (html: string): string => {
  if (!html) {
    return "";
  }
  if (typeof window === "undefined") {
    return html
      .replaceAll(/<[^>]+>/gu, " ")
      .replaceAll(/\s+/gu, " ")
      .trim();
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent?.replaceAll(/\s+\n/gu, "\n").trim() ?? "";
};

export const escapeComposeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const textToComposeBodyHtml = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }

  return normalized
    .split(/\r?\n(?:\r?\n)+/gu)
    .map(
      (paragraph) =>
        `<p>${paragraph
          .split(/\r?\n/gu)
          .map((line) => (line ? escapeComposeHtml(line) : "<br>"))
          .join("<br>")}</p>`
    )
    .join("");
};

const COMPOSE_SIGNATURE_MARKER = "data-quieter-signature";

export const appendComposeSignature = (
  draft: ComposeDraftState,
  signature: {
    html: string | null | undefined;
    text: string | null | undefined;
  }
): ComposeDraftState => {
  const html = signature.html?.trim();
  const text = signature.text?.trim();
  const authoredHtml = draft.bodyHtml.trim()
    ? draft.bodyHtml
    : textToComposeBodyHtml(draft.bodyText);
  if (!html && !text) {
    return authoredHtml === draft.bodyHtml
      ? draft
      : { ...draft, bodyHtml: authoredHtml };
  }
  if (draft.bodyHtml.includes(COMPOSE_SIGNATURE_MARKER)) {
    return draft;
  }

  const signatureHtml = `<div ${COMPOSE_SIGNATURE_MARKER}="true"><br>${html || textToComposeBodyHtml(text ?? "")}</div>`;
  const nextHtml = authoredHtml.trim()
    ? `${authoredHtml}${signatureHtml}`
    : `<p></p>${signatureHtml.replace("<br>", "")}`;
  const signatureText = text || htmlToText(html ?? "");
  const nextText = draft.bodyText.trim()
    ? `${draft.bodyText.trim()}\n\n${signatureText}`
    : signatureText;

  return { ...draft, bodyHtml: nextHtml, bodyText: nextText };
};

const hasMeaningfulBodyHtml = (bodyHtml: string): boolean => {
  const normalizedHtml = bodyHtml.trim();
  if (!normalizedHtml) {
    return false;
  }

  if (typeof window === "undefined") {
    return /<(?:img|video|audio|iframe)\b/iu.test(normalizedHtml);
  }

  const doc = new DOMParser().parseFromString(normalizedHtml, "text/html");
  return !!doc.body.querySelector("img,video,audio,iframe");
};

export const normalizeComposeBodyHtml = (bodyHtml: string): string => {
  const normalizedHtml = bodyHtml.trim();
  if (!normalizedHtml) {
    return "";
  }

  if (normalizeString(htmlToText(normalizedHtml))) {
    return normalizedHtml;
  }

  return hasMeaningfulBodyHtml(normalizedHtml) ? normalizedHtml : "";
};

export const getRenderableComposeBodyHtml = (
  bodyHtml: string,
  bodyText: string
): string =>
  normalizeComposeBodyHtml(bodyHtml) || textToComposeBodyHtml(bodyText);

export const hasComposeDraftContent = (draft: ComposeDraftState): boolean =>
  !!(
    normalizeString(draft.recipients.to) ||
    normalizeString(draft.recipients.cc) ||
    normalizeString(draft.recipients.bcc) ||
    normalizeString(draft.subject) ||
    normalizeComposeBodyHtml(draft.bodyHtml) ||
    normalizeString(draft.bodyText) ||
    draft.attachments.length > 0 ||
    draft.inlineImages.length > 0
  );

const attachRuntimeFile = async <
  T extends ComposeAttachment | ComposeInlineImage,
>(
  asset: T,
  mailboxId: string,
  messageId: string | undefined,
  signal?: AbortSignal
) => {
  const runtimeFile = runtimeBinaryById.get(asset.id)?.file;
  if (!runtimeFile) {
    const sourceMessageId = asset.sourceMessageId ?? messageId;
    if (asset.gmailAttachmentId && sourceMessageId) {
      const pending = { removed: false };
      pendingRuntimeFiles.set(asset.id, pending);
      try {
        const { file } = await rpc.mail.getAttachment(
          {
            attachmentId: asset.gmailAttachmentId,
            fileName: asset.name,
            mailboxId,
            messageId: sourceMessageId,
            mimeType: asset.mimeType,
          },
          { signal }
        );
        if (!pending.removed) {
          rememberRuntimeFile(asset.id, file);
        }
        return { ...asset, file };
      } finally {
        if (pendingRuntimeFiles.get(asset.id) === pending) {
          pendingRuntimeFiles.delete(asset.id);
        }
      }
    }
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

const createComposeAssetBase = (
  file: File,
  options: CreateComposeAssetOptions = {}
) => {
  const id = options.id ?? crypto.randomUUID();
  rememberRuntimeFile(id, file);

  return {
    gmailAttachmentId: options.gmailAttachmentId,
    id,
    mimeType: file.type || "application/octet-stream",
    name: file.name,
    size: file.size,
  };
};

const createComposeInlineImageFromFile = (
  file: File,
  options?: CreateComposeAssetOptions & { contentId?: string }
): ComposeInlineImage => {
  const asset = createComposeAssetBase(file, options);

  return {
    ...asset,
    contentId: options?.contentId ?? `${CONTENT_ID_PREFIX}-${asset.id}`,
    isInline: true,
  };
};

export const createComposeInlineImagesFromFiles = (files: FileList | File[]) =>
  Array.from(files, (file) => createComposeInlineImageFromFile(file));

const assertAttachmentBudget = (assets: readonly { size: number }[]) => {
  const totalSize = assets.reduce((sum, asset) => sum + asset.size, 0);

  if (totalSize > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new Error("Attachments exceed the 24MB compose limit.");
  }
};

export const addComposeAttachmentFiles = (
  draft: ComposeDraftState,
  files: File[]
): ComposeDraftState => {
  assertAttachmentBudget([
    ...draft.attachments,
    ...draft.inlineImages,
    ...files,
  ]);
  return {
    ...draft,
    attachments: [
      ...draft.attachments,
      ...files.map((file) => ({
        ...createComposeAssetBase(file),
        isInline: false as const,
      })),
    ],
    errorMessage: null,
    updatedAt: Date.now(),
  };
};

const findReferencedInlineImageIds = (html: string): Set<string> => {
  if (html.length === 0 || typeof window === "undefined") {
    return new Set();
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  const ids = new Set<string>();

  for (const image of doc.querySelectorAll<HTMLImageElement>(
    "img[data-compose-inline-id]"
  )) {
    const imageId = image.dataset.composeInlineId;
    if (imageId) {
      ids.add(imageId);
    }
  }

  return ids;
};

export const syncInlineImagesWithHtml = (
  draft: ComposeDraftState,
  bodyHtml: string
): ComposeDraftState => {
  const referencedIds = findReferencedInlineImageIds(bodyHtml);
  const nextInlineImages = draft.inlineImages.filter((image) =>
    referencedIds.has(image.id)
  );

  return {
    ...draft,
    bodyHtml,
    bodyText: htmlToText(bodyHtml),
    inlineImages: nextInlineImages,
    updatedAt: Date.now(),
  };
};

const serializeDraft = async (
  mailboxId: string,
  draft: ComposeDraftState,
  signal?: AbortSignal
) => {
  assertAttachmentBudget([...draft.attachments, ...draft.inlineImages]);
  const [inlineImages, attachments] = await Promise.all([
    Promise.all(
      draft.inlineImages.map(
        async (image) =>
          await attachRuntimeFile(image, mailboxId, draft.messageId, signal)
      )
    ),
    Promise.all(
      draft.attachments.map(
        async (attachment) =>
          await attachRuntimeFile(
            attachment,
            mailboxId,
            draft.messageId,
            signal
          )
      )
    ),
  ]);

  return {
    ...draft,
    attachments,
    inlineImages,
  };
};

export const prepareLoadedComposeDraft = async (
  mailboxId: string,
  draft: ComposeDraftState,
  signal?: AbortSignal
): Promise<ComposeDraftState> => {
  const loaded = await Promise.allSettled(
    [...draft.inlineImages, ...draft.attachments].map(
      async (asset) =>
        await attachRuntimeFile(asset, mailboxId, draft.messageId, signal)
    )
  );
  for (const result of loaded) {
    if (result.status === "rejected") {
      throw result.reason;
    }
  }
  signal?.throwIfAborted();
  const doc = new DOMParser().parseFromString(draft.bodyHtml, "text/html");
  for (const element of doc.querySelectorAll<HTMLImageElement>("img")) {
    const image = draft.inlineImages.find(
      (asset) =>
        asset.id === element.dataset.composeInlineId ||
        asset.contentId ===
          `${CONTENT_ID_PREFIX}-${element.dataset.composeInlineId ?? ""}` ||
        element.getAttribute("src")?.toLowerCase() ===
          `cid:${asset.contentId.toLowerCase()}`
    );
    if (image) {
      const objectUrl = getComposeRuntimeObjectUrl(image.id);
      if (objectUrl) {
        element.setAttribute("src", objectUrl);
        element.dataset.composeInlineId = image.id;
      }
    }
  }
  return { ...draft, bodyHtml: doc.body.innerHTML };
};

export const saveComposeDraft = async (
  mailboxId: string,
  draft: ComposeDraftState,
  signal?: AbortSignal
): Promise<ComposeDraftState> => {
  const response = await rpc.mail.saveDraft(
    { draft: await serializeDraft(mailboxId, draft, signal), mailboxId },
    { signal }
  );
  return {
    ...draft,
    attachments: response.attachments,
    baseRevision: response.baseRevision,
    draftId: response.draftId,
    errorMessage: null,
    inlineImages: response.inlineImages,
    lastSavedAt: Date.now(),
    messageId: response.messageId ?? undefined,
    saveStatus: "saved",
    updatedAt: Date.now(),
  };
};

export const sendComposeMessage = async (
  mailboxId: string,
  draft: ComposeDraftState,
  signal?: AbortSignal
) => {
  const message = await serializeDraft(mailboxId, draft, signal);
  try {
    return await rpc.mail.sendMessage({ mailboxId, message }, { signal });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "data" in error &&
      typeof error.data === "object" &&
      error.data !== null &&
      "sendRejected" in error.data &&
      error.data.sendRejected === true
    ) {
      throw error;
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof error.status === "number" &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 408
    ) {
      throw error;
    }
    throw Object.assign(
      new Error(
        "Delivery could not be confirmed. Check Sent before sending again.",
        { cause: error }
      ),
      { data: { deliveryUncertain: true } }
    );
  }
};

export const deleteComposeDraft = async (
  mailboxId: string,
  draft: ComposeDraftState,
  signal?: AbortSignal
) => {
  if (
    draft.draftId === null ||
    draft.draftId === undefined ||
    draft.draftId === ""
  ) {
    return;
  }
  await rpc.mail.deleteDraft(
    { baseRevision: draft.baseRevision, draftId: draft.draftId, mailboxId },
    { signal }
  );
};

export const attachInlineImagesToHtml = (
  draft: ComposeDraftState,
  images: ComposeInlineImage[]
): string => {
  if (typeof window === "undefined") {
    return draft.bodyHtml;
  }

  const doc = new DOMParser().parseFromString(
    draft.bodyHtml || "<p></p>",
    "text/html"
  );
  const { body } = doc;

  if (body.innerHTML.trim().length === 0) {
    body.innerHTML = "<p></p>";
  }

  for (const image of images) {
    const paragraph = doc.createElement("p");
    const element = doc.createElement("img");
    const objectUrl = getComposeRuntimeObjectUrl(image.id);
    if (!objectUrl) {
      continue;
    }

    element.setAttribute("src", objectUrl);
    element.setAttribute("alt", image.name);
    element.dataset.composeInlineId = image.id;
    paragraph.append(element);
    body.append(paragraph);
  }

  return body.innerHTML.trim();
};
