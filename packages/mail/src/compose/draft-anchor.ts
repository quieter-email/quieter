import {
  composeDraftSeededBySchema,
  QUIETER_DRAFT_HEADER_NAMES,
} from "./schema";
import type { ComposeDraftAnchor } from "./schema";

type HeaderReader = (name: string) => string | undefined;

export const parseDraftAnchorFromHeaderReader = (
  readHeader: HeaderReader
): ComposeDraftAnchor | undefined => {
  const sourceMessageId = readHeader(
    QUIETER_DRAFT_HEADER_NAMES.sourceMessageId
  )?.trim();
  const sourceThreadId = readHeader(
    QUIETER_DRAFT_HEADER_NAMES.sourceThreadId
  )?.trim();
  const seededByValue = readHeader(QUIETER_DRAFT_HEADER_NAMES.seededBy)?.trim();
  const seededBy = composeDraftSeededBySchema.safeParse(seededByValue);

  if (
    sourceMessageId === undefined ||
    sourceMessageId.length === 0 ||
    sourceThreadId === undefined ||
    sourceThreadId.length === 0 ||
    !seededBy.success
  ) {
    return undefined;
  }

  const sourceMessageHeaderId = readHeader(
    QUIETER_DRAFT_HEADER_NAMES.sourceMessageHeaderId
  )?.trim();

  return {
    seededBy: seededBy.data,
    sourceMessageHeaderId:
      sourceMessageHeaderId !== undefined && sourceMessageHeaderId.length > 0
        ? sourceMessageHeaderId
        : undefined,
    sourceMessageId,
    sourceThreadId,
  };
};
