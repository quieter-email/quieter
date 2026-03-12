import { trpc } from "~/lib/trpc";
export { loadAttachmentFromServer } from "./attachments";

const MAX_TOTAL_ATTACHMENT_BYTES = 24 * 1024 * 1024;
const MAX_VISIBLE_INLINE_DRAFTS = 2;
const CONTENT_ID_PREFIX = "quietr-inline";

export type ComposeSaveStatus = "idle" | "saving" | "saved" | "error" | "sending" | "discarding";

export type ComposeRecipientFields = {
  to: string;
  cc: string;
  bcc: string;
};

export type ComposeAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  gmailAttachmentId?: string;
  bytes?: number[];
  isInline: boolean;
};

export type ComposeInlineImage = ComposeAttachment & {
  contentId: string;
};

export type ComposeDraftState = {
  localId: string;
  draftId?: string;
  messageId?: string;
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

const normalizeString = (value: string): string => value.trim();

const createEmptyRecipients = (): ComposeRecipientFields => ({
  to: "",
  cc: "",
  bcc: "",
});

export const createEmptyComposeDraft = (): ComposeDraftState => ({
  localId: createLocalId(),
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
  ({ ...attachment, bytes: attachment.bytes ? [...attachment.bytes] : undefined }) as T;

export const cloneComposeDraft = (draft: ComposeDraftState): ComposeDraftState => ({
  ...draft,
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

const splitRecipients = (value: string): string[] =>
  value
    .split(/[\n,;]/g)
    .map((part) => normalizeString(part))
    .filter(Boolean);

const extractAddress = (value: string): string => {
  const match = value.match(/<([^>]+)>/);
  return normalizeString(match?.[1] ?? value);
};

export const validateRecipientInput = (value: string): string[] => {
  return splitRecipients(value).filter((recipient) => {
    const address = extractAddress(recipient);
    return !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address);
  });
};

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

export const hasComposeDraftContent = (draft: ComposeDraftState): boolean => {
  return Boolean(
    normalizeString(draft.recipients.to) ||
    normalizeString(draft.recipients.cc) ||
    normalizeString(draft.recipients.bcc) ||
    normalizeString(draft.subject) ||
    normalizeString(draft.bodyHtml) ||
    normalizeString(draft.bodyText) ||
    draft.attachments.length > 0 ||
    draft.inlineImages.length > 0,
  );
};

const fileToBytes = async (file: File): Promise<number[]> =>
  Array.from(new Uint8Array(await file.arrayBuffer()));

const hydrateBytesFromRuntime = async <T extends ComposeAttachment | ComposeInlineImage>(
  asset: T,
): Promise<T> => {
  if (asset.bytes?.length) return asset;
  const runtimeFile = getComposeRuntimeFile(asset.id);
  if (!runtimeFile) {
    throw new Error(`Missing file payload for ${asset.name}.`);
  }

  return {
    ...asset,
    bytes: await fileToBytes(runtimeFile),
  } as T;
};

const createInlineImageFromFile = async (file: File): Promise<ComposeInlineImage> => {
  const id = createLocalId();
  rememberRuntimeFile(id, file);
  return {
    id,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    contentId: `${CONTENT_ID_PREFIX}-${id}`,
    bytes: await fileToBytes(file),
    isInline: true,
  };
};

const createAttachmentFromFile = async (file: File): Promise<ComposeAttachment> => {
  const id = createLocalId();
  rememberRuntimeFile(id, file);
  return {
    id,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    bytes: await fileToBytes(file),
    isInline: false,
  };
};

export const createComposeAttachmentsFromFiles = async (files: FileList | File[]) =>
  await Promise.all(Array.from(files, async (file) => await createAttachmentFromFile(file)));

export const createComposeInlineImagesFromFiles = async (files: FileList | File[]) =>
  await Promise.all(Array.from(files, async (file) => await createInlineImageFromFile(file)));

const assertAttachmentBudget = (draft: ComposeDraftState) => {
  const totalSize =
    draft.attachments.reduce((sum, attachment) => sum + attachment.size, 0) +
    draft.inlineImages.reduce((sum, image) => sum + image.size, 0);

  if (totalSize > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new Error("Attachments exceed the 24MB compose limit.");
  }
};

const decodeBase64UrlToBytes = (value: string): Uint8Array => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const encodeBase64UrlFromBytes = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
};

const parseDraftResponse = (response: {
  draftId: string;
  messageId?: string | null;
  bodyHtml: string;
  bodyText: string;
  subject: string;
  recipients: ComposeRecipientFields;
}) => ({
  draftId: response.draftId,
  messageId: response.messageId ?? undefined,
  bodyHtml: response.bodyHtml,
  bodyText: response.bodyText,
  subject: response.subject,
  recipients: response.recipients,
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
  const doc = new DOMParser().parseFromString(html, "text/html");

  for (const image of Array.from(doc.querySelectorAll("img[data-compose-inline-id]"))) {
    const imageId = image.getAttribute("data-compose-inline-id");
    if (!imageId) continue;
    const asset = inlineImageById.get(imageId);
    if (!asset) continue;
    const objectUrl = getComposeRuntimeObjectUrl(asset.id);
    if (objectUrl) {
      image.setAttribute("src", objectUrl);
    }
  }

  return doc.body.innerHTML.trim();
};

export const hydrateComposeDraftRuntime = async (
  draft: ComposeDraftState,
  signal?: AbortSignal,
): Promise<ComposeDraftState> => {
  if (!draft.draftId) return draft;

  const response = await trpc.gmail.loadDraft.query({ draftId: draft.draftId }, { signal });

  return {
    ...draft,
    messageId: response.messageId ?? draft.messageId,
    recipients: response.recipients,
    subject: response.subject,
    bodyHtml: updateInlineImageHtml(
      response.bodyHtml,
      draft.inlineImages.slice(0, MAX_VISIBLE_INLINE_DRAFTS),
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
  const inlineImages = await Promise.all(
    draft.inlineImages.map(async (image) => await hydrateBytesFromRuntime(image)),
  );
  const attachments = await Promise.all(
    draft.attachments
      .filter((attachment) => !attachment.isInline)
      .map(async (attachment) => await hydrateBytesFromRuntime(attachment)),
  );

  return {
    ...draft,
    attachments,
    inlineImages,
  };
};

export const saveComposeDraft = async (
  draft: ComposeDraftState,
  signal?: AbortSignal,
): Promise<ComposeDraftState> => {
  const response = await trpc.gmail.saveDraft.mutate(
    { draft: await serializeDraft(draft) },
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

export const sendComposeDraft = async (draft: ComposeDraftState, signal?: AbortSignal) => {
  return await trpc.gmail.sendDraft.mutate({ draft: await serializeDraft(draft) }, { signal });
};

export const deleteComposeDraft = async (draft: ComposeDraftState, signal?: AbortSignal) => {
  if (!draft.draftId) return;
  await trpc.gmail.deleteDraft.mutate({ draftId: draft.draftId }, { signal });
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

export { decodeBase64UrlToBytes, encodeBase64UrlFromBytes };
