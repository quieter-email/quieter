const MAX_THREAD_HEADER_LENGTH = 65_536;
const MAX_THREAD_REFERENCES = 1000;

export const extractMessageIds = (value?: string | null): string[] => {
  if (!value || value.length > MAX_THREAD_HEADER_LENGTH) {
    return [];
  }

  const references: string[] = [];
  let offset = 0;
  while (offset < value.length) {
    const start = value.indexOf("<", offset);
    if (start === -1) {
      break;
    }
    const end = value.indexOf(">", start + 1);
    if (end === -1) {
      break;
    }
    const candidate = value.slice(start + 1, end);
    if (candidate.length > 0 && !candidate.includes("<")) {
      references.push(value.slice(start, end + 1));
      if (references.length > MAX_THREAD_REFERENCES) {
        return [];
      }
    }
    offset = end + 1;
  }
  return references;
};

export const getReplyReferenceIds = (message: {
  inReplyTo?: string;
  references?: string;
}): string[] => [
  ...new Set(
    [
      ...(message.inReplyTo !== undefined &&
      message.inReplyTo.length <= MAX_THREAD_HEADER_LENGTH
        ? [message.inReplyTo.trim()]
        : []),
      ...extractMessageIds(message.references),
    ].filter(Boolean)
  ),
];
