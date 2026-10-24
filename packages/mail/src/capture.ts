import { convert } from "html-to-text";
import { addressParser } from "postal-mime";
import { z } from "zod";

import type { MessageAttachment, MessageHeader } from "./messages";

export const MAIL_MESSAGE_ANALYSIS_VERSION = 1;
export const MAIL_CAPTURE_BODY_LIMIT = 512_000;
export const MAIL_CAPTURE_HEADER_LIMIT = 128;
export const MAIL_CAPTURE_HEADER_VALUE_LIMIT = 8192;
const CANDIDATE_LIMIT = 32;
const captureAnchorAttributes = z.object({
  "aria-label": z.string().optional(),
  href: z.string().optional(),
});
const EXPLICIT_UNSUBSCRIBE = /\b(?:unsubscribe|abmelden|abbestellen)\b/iu;

export type MailMessageAnalysis = {
  version: number;
  sender: { address: string; name: string | null; domain: string } | null;
  listId: string | null;
  unsubscribe: {
    headerTargets: { kind: "https" | "http" | "mailto"; target: string }[];
    oneClickAdvertised: boolean;
    bodyCandidates: {
      target: string;
      label: string;
      source: "html" | "text";
    }[];
  };
  truncated: boolean;
};

export type CapturedMailSnapshot = {
  id: string;
  threadId: string;
  providerRevision: string;
  internalDate: string | null;
  headers: MessageHeader[];
  bodyText: string | null;
  bodyHtml: string | null;
  labelIds: string[];
  attachments: MessageAttachment[];
  truncation: {
    bodyText: boolean;
    bodyHtml: boolean;
    headers: boolean;
    attachments: boolean;
  };
};

export type MailCaptureHistoryPage = {
  changes: {
    kind: "added" | "deleted" | "labels";
    messageId: string;
    providerRevision: string;
  }[];
  historyId: string;
  nextPageToken: string | null;
};

export type MailCaptureIdPage = {
  messageIds: string[];
  nextPageToken: string | null;
};

export const truncateMailCaptureText = (
  value: string,
  limit: number
): string => {
  const prefix = value.slice(0, limit);
  return prefix.replace(/\p{Surrogate}$/u, "").toWellFormed();
};

export const boundMailCaptureContent = (input: {
  bodyText?: string | null;
  bodyHtml?: string | null;
  headers: MessageHeader[];
}): Pick<CapturedMailSnapshot, "bodyHtml" | "bodyText" | "headers"> & {
  truncation: Omit<CapturedMailSnapshot["truncation"], "attachments">;
} => {
  let headerCharacters = 0;
  const headers: MessageHeader[] = [];
  let headersTruncated = input.headers.length > MAIL_CAPTURE_HEADER_LIMIT;
  for (const header of input.headers.slice(0, MAIL_CAPTURE_HEADER_LIMIT)) {
    if (headerCharacters >= 64_000) {
      headersTruncated = true;
      break;
    }
    const name = truncateMailCaptureText(header.name, 256);
    const value = truncateMailCaptureText(
      header.value,
      Math.max(
        0,
        Math.min(
          MAIL_CAPTURE_HEADER_VALUE_LIMIT,
          64_000 - headerCharacters - name.length
        )
      )
    );
    headerCharacters += name.length + value.length;
    headersTruncated ||= name !== header.name || value !== header.value;
    headers.push({ name, value });
  }
  return {
    bodyHtml:
      typeof input.bodyHtml === "string"
        ? truncateMailCaptureText(input.bodyHtml, MAIL_CAPTURE_BODY_LIMIT)
        : null,
    bodyText:
      typeof input.bodyText === "string"
        ? truncateMailCaptureText(input.bodyText, MAIL_CAPTURE_BODY_LIMIT)
        : null,
    headers,
    truncation: {
      bodyHtml: (input.bodyHtml?.length ?? 0) > MAIL_CAPTURE_BODY_LIMIT,
      bodyText: (input.bodyText?.length ?? 0) > MAIL_CAPTURE_BODY_LIMIT,
      headers: headersTruncated,
    },
  };
};

export const parseMailUnsubscribeTarget = (
  value: string
): MailMessageAnalysis["unsubscribe"]["headerTargets"][number] | null => {
  const target = value.trim();
  // oxlint-disable-next-line eslint/no-control-regex -- reject control characters in persisted targets.
  const hasControls = /[\u0000-\u0020\u007F]|%0[ad]/iu.test(target);
  if (target.length > 4096 || hasControls) {
    return null;
  }
  try {
    const url = new URL(target);
    if (url.username || url.password) {
      return null;
    }
    if (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.hostname
    ) {
      return {
        kind:
          url.protocol === "https:" ? ("https" as const) : ("http" as const),
        target: url.href,
      };
    }
    if (
      url.protocol === "mailto:" &&
      /^[^<>\s@]+@[^<>\s@]+$/u.test(url.pathname)
    ) {
      return { kind: "mailto" as const, target: url.href };
    }
  } catch {
    return null;
  }
  return null;
};

export const analyzeMailMessage = (input: {
  from?: string | null;
  headers: MessageHeader[];
  bodyText?: string | null;
  bodyHtml?: string | null;
}): MailMessageAnalysis => {
  const bounded = boundMailCaptureContent(input);
  const headerValues = (name: string) =>
    bounded.headers
      .filter((header) => header.name.toLowerCase() === name)
      .map((header) => header.value);
  const from = truncateMailCaptureText(
    input.from ?? headerValues("from")[0] ?? "",
    MAIL_CAPTURE_HEADER_VALUE_LIMIT
  );
  const senders = addressParser(from, { flatten: true });
  const [sender] = senders;
  const address = sender?.address?.trim().toLowerCase() ?? "";
  const normalizedSender =
    senders.length === 1 &&
    sender?.group === undefined &&
    /^[^<>\s@]+@[^<>\s@]+$/u.test(address)
      ? {
          address,
          domain: address.slice(address.lastIndexOf("@") + 1),
          name: truncateMailCaptureText(sender.name.trim(), 512) || null,
        }
      : null;
  const headerTargets: MailMessageAnalysis["unsubscribe"]["headerTargets"] = [];
  const seenHeaderTargets = new Set<string>();
  let truncated = Object.values(bounded.truncation).some(Boolean);
  for (const header of headerValues("list-unsubscribe")) {
    for (const match of header.matchAll(/<(?<target>[^<>]+)>/gu)) {
      const target = parseMailUnsubscribeTarget(match.groups?.target ?? "");
      if (!target || seenHeaderTargets.has(target.target)) {
        continue;
      }
      if (headerTargets.length >= CANDIDATE_LIMIT) {
        truncated = true;
        break;
      }
      seenHeaderTargets.add(target.target);
      headerTargets.push(target);
    }
  }
  const bodyCandidates: MailMessageAnalysis["unsubscribe"]["bodyCandidates"] =
    [];
  const seenBodyTargets = new Set<string>();
  const addBodyCandidate = (
    targetValue: string,
    labelValue: string,
    source: "html" | "text"
  ) => {
    const label = labelValue.replaceAll(/\s+/gu, " ").trim();
    if (!EXPLICIT_UNSUBSCRIBE.test(label)) {
      return;
    }
    const target = parseMailUnsubscribeTarget(targetValue);
    if (!target || seenBodyTargets.has(target.target)) {
      return;
    }
    if (bodyCandidates.length >= CANDIDATE_LIMIT) {
      truncated = true;
      return;
    }
    seenBodyTargets.add(target.target);
    bodyCandidates.push({
      label: truncateMailCaptureText(label, 256),
      source,
      target: target.target,
    });
  };
  if (bounded.bodyHtml) {
    convert(bounded.bodyHtml, {
      formatters: {
        captureAnchor: (element, walk, builder) => {
          const nodes = [...element.children];
          const pieces: string[] = [];
          let visited = 0;
          while (nodes.length > 0 && visited < 256) {
            const node = nodes.shift();
            visited += 1;
            if (node?.type === "text" && node.data) {
              pieces.push(node.data);
            } else if (node?.children) {
              nodes.unshift(...node.children.slice(0, 256));
            }
          }
          const attributes = captureAnchorAttributes.safeParse(element.attribs);
          if (attributes.success) {
            addBodyCandidate(
              attributes.data.href ?? "",
              pieces.join(" ") || attributes.data["aria-label"] || "",
              "html"
            );
          }
          walk(element.children, builder);
        },
      },
      limits: {
        maxChildNodes: 10_000,
        maxDepth: 64,
        maxInputLength: MAIL_CAPTURE_BODY_LIMIT,
      },
      selectors: [{ format: "captureAnchor", selector: "a" }],
      wordwrap: false,
    });
  }
  for (const line of (bounded.bodyText ?? "").split(/\r?\n/u)) {
    if (EXPLICIT_UNSUBSCRIBE.test(line) && line.length < 2048) {
      for (const match of line.matchAll(
        /(?:https?:\/\/|mailto:)[^\s<>"']+/giu
      )) {
        addBodyCandidate(match[0].replace(/[),.;]+$/u, ""), line, "text");
      }
    }
  }
  const [listHeader] = headerValues("list-id");
  const listId =
    /<(?<listId>[^<>\s]+)>/u.exec(listHeader)?.groups?.listId?.toLowerCase() ??
    null;
  return {
    listId: listId === null ? null : truncateMailCaptureText(listId, 512),
    sender: normalizedSender,
    truncated,
    unsubscribe: {
      bodyCandidates,
      headerTargets,
      oneClickAdvertised:
        headerTargets.some((target) => target.kind === "https") &&
        headerValues("list-unsubscribe-post").some((value) =>
          /^\s*List-Unsubscribe\s*=\s*One-Click\s*$/iu.test(value)
        ),
    },
    version: MAIL_MESSAGE_ANALYSIS_VERSION,
  };
};
