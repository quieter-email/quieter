import { addressParser } from "postal-mime";
import { z } from "zod";

import type { MessageListItem } from "./messages";

type HistoryMessage = Pick<
  MessageListItem,
  "from" | "to" | "cc" | "bcc" | "labelIds"
>;

type HistoryCorrespondent = { email: string; name: string | null };

const correspondentEmailSchema = z.email();

export const getHistoryCorrespondents = (
  messages: readonly HistoryMessage[]
): HistoryCorrespondent[] => {
  const correspondents = new Map<string, HistoryCorrespondent>();
  for (const message of messages) {
    if (
      message.labelIds?.some((label) =>
        ["DRAFT", "SPAM", "TRASH"].includes(label)
      ) === true
    ) {
      continue;
    }
    for (const header of [message.from, message.to, message.cc, message.bcc]) {
      if (!header) {
        continue;
      }
      for (const address of addressParser(header, { flatten: true })) {
        const email = address.address?.trim().toLowerCase();
        if (!email || !correspondentEmailSchema.safeParse(email).success) {
          continue;
        }
        const previous = correspondents.get(email);
        correspondents.set(email, {
          email,
          name: previous?.name ?? (address.name?.trim() || null),
        });
      }
    }
  }
  return [...correspondents.values()];
};

export const matchesHistoryCorrespondent = (
  message: HistoryMessage,
  correspondentEmail: string
): boolean =>
  getHistoryCorrespondents([message]).some(
    (correspondent) => correspondent.email === correspondentEmail
  );
