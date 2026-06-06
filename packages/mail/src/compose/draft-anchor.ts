import {
  composeDraftSeededBySchema,
  QUIETER_DRAFT_HEADER_NAMES,
  type ComposeDraftAnchor,
} from "./schema";

type HeaderReader = (name: string) => string | undefined;

export const parseDraftAnchorFromHeaderReader = (
  readHeader: HeaderReader,
): ComposeDraftAnchor | undefined => {
  const sourceMessageId = readHeader(QUIETER_DRAFT_HEADER_NAMES.sourceMessageId)?.trim();
  const sourceThreadId = readHeader(QUIETER_DRAFT_HEADER_NAMES.sourceThreadId)?.trim();
  const seededByValue = readHeader(QUIETER_DRAFT_HEADER_NAMES.seededBy)?.trim();
  const seededBy = composeDraftSeededBySchema.safeParse(seededByValue);

  if (!sourceMessageId || !sourceThreadId || !seededBy.success) {
    return undefined;
  }

  const sourceMessageHeaderId = readHeader(
    QUIETER_DRAFT_HEADER_NAMES.sourceMessageHeaderId,
  )?.trim();

  return {
    sourceMessageId,
    sourceMessageHeaderId: sourceMessageHeaderId || undefined,
    sourceThreadId,
    seededBy: seededBy.data,
  };
};
