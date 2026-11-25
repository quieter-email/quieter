import { addressParser } from "postal-mime";

import type { MessageListItem } from "./messages";

export const matchesHistoryCorrespondent = (
  message: Pick<MessageListItem, "from" | "to" | "cc" | "bcc" | "labelIds">,
  correspondentEmail: string
): boolean => {
  if (
    message.labelIds?.some((label) =>
      ["DRAFT", "SPAM", "TRASH"].includes(label)
    ) === true
  ) {
    return false;
  }
  for (const header of [message.from, message.to, message.cc, message.bcc]) {
    if (
      header &&
      addressParser(header, { flatten: true }).some(
        (address) =>
          address.address?.trim().toLowerCase() === correspondentEmail
      )
    ) {
      return true;
    }
  }
  return false;
};
