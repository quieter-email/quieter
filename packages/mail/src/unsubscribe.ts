import { z } from "zod";

import { extractMailAddress, splitMailAddressList } from "./compose/schema";
import type { MessageHeader } from "./messages";

export const getUnsubscribeKey = (
  headers: readonly MessageHeader[]
): string | undefined => {
  const listIds = headers.filter(
    (header) => header.name.toLowerCase() === "list-id"
  );
  if (listIds.length === 1) {
    const match =
      /^[^<>\r\n]*<(?<id>[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)+)>\s*$/iu.exec(
        listIds[0].value.replaceAll(/\r?\n[ \t]+/gu, " ").trim()
      );
    if (match?.groups?.id) {
      return `list:${match.groups.id.toLowerCase()}`;
    }
  }
  const senders = headers.filter(
    (header) => header.name.toLowerCase() === "from"
  );
  if (senders.length !== 1) {
    return undefined;
  }
  const addresses = splitMailAddressList(senders[0].value);
  if (addresses.length !== 1) {
    return undefined;
  }
  const address = extractMailAddress(addresses[0]).toLowerCase();
  return z.email().safeParse(address).success ? `sender:${address}` : undefined;
};
