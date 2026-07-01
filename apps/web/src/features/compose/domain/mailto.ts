import { createEmptyComposeDraft, type ComposeDraftState } from "./draft";

const MAILTO_PROTOCOL = "mailto:";

const decodeMailtoPath = (value: string): string | null => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

const splitRecipients = (value: string) =>
  value.split(",").flatMap((recipient) => {
    const trimmed = recipient.trim();
    return trimmed ? [trimmed] : [];
  });

const firstNonEmpty = (values: string[]) => values.find((value) => value.trim())?.trim() ?? "";

export const parseMailtoComposeDraft = (value: string): ComposeDraftState | null => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol.toLowerCase() !== MAILTO_PROTOCOL) {
    return null;
  }

  const decodedPath = decodeMailtoPath(url.pathname);
  if (decodedPath === null) {
    return null;
  }

  const recipients = {
    bcc: [] as string[],
    cc: [] as string[],
    to: splitRecipients(decodedPath),
  };
  const bodyValues: string[] = [];
  const subjectValues: string[] = [];

  for (const [rawName, rawValue] of url.searchParams) {
    const name = rawName.toLowerCase();

    if (name === "to" || name === "cc" || name === "bcc") {
      recipients[name].push(...splitRecipients(rawValue));
    } else if (name === "subject") {
      subjectValues.push(rawValue);
    } else if (name === "body") {
      bodyValues.push(rawValue);
    }
  }

  return {
    ...createEmptyComposeDraft(),
    bodyText: firstNonEmpty(bodyValues),
    recipients: {
      bcc: recipients.bcc.join(", "),
      cc: recipients.cc.join(", "),
      to: recipients.to.join(", "),
    },
    subject: firstNonEmpty(subjectValues),
  };
};
