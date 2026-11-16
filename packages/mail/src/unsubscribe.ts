import { z } from "zod";

import { extractMailAddress, splitMailAddressList } from "./compose/schema";
import { decodeMimeHeaderValue } from "./message-content";
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

export const extractListUnsubscribeTargets = (
  value: string | undefined
): { mailto: string | undefined; url: string | undefined } => {
  const normalized = decodeMimeHeaderValue(value)?.trim();
  let mailto: string | undefined;
  let url: string | undefined;

  for (const candidate of normalized
    ?.match(/<[^>]+>|[^,]+/gu)
    ?.map((entry) => entry.trim().replaceAll(/^<|>$/gu, "").trim())
    .filter(Boolean) ?? []) {
    const normalizedCandidate = candidate.toLowerCase();
    if (
      !normalizedCandidate.startsWith("mailto:") &&
      !normalizedCandidate.startsWith("http://") &&
      !normalizedCandidate.startsWith("https://")
    ) {
      continue;
    }

    try {
      const parsedUrl = new URL(candidate);

      if (mailto === undefined && parsedUrl.protocol === "mailto:") {
        const pathname = decodeURIComponent(parsedUrl.pathname).trim();
        const queryTo = parsedUrl.searchParams.get("to")?.trim();

        if (pathname !== "" || (queryTo !== undefined && queryTo !== "")) {
          mailto = candidate;
        }
      }

      if (
        url === undefined &&
        (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:")
      ) {
        url = candidate;
      }
    } catch {
      continue;
    }
  }

  return { mailto, url };
};
