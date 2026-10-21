import { compile } from "html-to-text";
import { addressParser } from "postal-mime";
import { z } from "zod";

import type { AutoLabelSettings } from "./auto-label";

const htmlToVisibleText = compile({
  selectors: [
    { format: "inline", selector: "a" },
    { format: "skip", selector: "img" },
    { format: "skip", selector: "script" },
    { format: "skip", selector: "style" },
    { format: "skip", selector: "[hidden]" },
    { format: "skip", selector: "[aria-hidden=true]" },
    { format: "skip", selector: '[style*="display:none"i]' },
    { format: "skip", selector: '[style*="display: none"i]' },
  ],
  wordwrap: false,
});

export const partitionAutoLabelCandidates = <
  Label extends {
    autoLabel?: AutoLabelSettings | null;
    id: string;
  },
>(
  labels: Label[],
  message: {
    bcc?: string | null;
    bodyHtml?: string | null;
    bodyText?: string | null;
    cc?: string | null;
    from?: string | null;
    snippet?: string | null;
    subject?: string | null;
    to?: string | null;
  }
): { aiLabels: Label[]; deterministicLabelIds: string[] } => {
  const deterministicLabelIds: string[] = [];
  const aiLabels: Label[] = [];
  const from = message.from?.trim() ?? "";
  const angleAddress = /^[^<>]*<(?<address>[^<>]+)>$/u.exec(from)?.groups
    ?.address;
  const parsedSender = z.email().safeParse(angleAddress ?? from);
  const sender = parsedSender.success ? parsedSender.data.toLowerCase() : null;
  const domain = sender?.slice(sender.lastIndexOf("@") + 1);
  const recipientAddresses = new Set(
    [message.to, message.cc, message.bcc].flatMap((value) =>
      addressParser(value ?? "", { flatten: true }).flatMap((address) => {
        const parsed = z.email().safeParse(address.address);
        return parsed.success ? [parsed.data.toLowerCase()] : [];
      })
    )
  );
  let body: string | undefined;

  for (const label of labels) {
    const settings = label.autoLabel;
    if (settings?.enabled === false) {
      continue;
    }
    if (!settings) {
      aiLabels.push(label);
      continue;
    }
    const matches: boolean[] = [];
    if (settings.senders.length > 0) {
      matches.push(sender !== null && settings.senders.includes(sender));
    }
    if (settings.recipients && settings.recipients.length > 0) {
      matches.push(
        settings.recipients.some((recipient) =>
          recipientAddresses.has(recipient)
        )
      );
    }
    if (settings.domains.length > 0) {
      matches.push(
        domain !== undefined &&
          settings.domains.some((pattern) =>
            pattern.startsWith("*.")
              ? domain.endsWith(pattern.slice(1))
              : domain === pattern
          )
      );
    }
    if (settings.keywords.length > 0) {
      if (settings.keywordScope !== "subject" && body === undefined) {
        body =
          message.bodyText?.trim() ||
          (message.bodyHtml
            ? htmlToVisibleText(message.bodyHtml)
            : (message.snippet ?? ""));
      }
      let text = `${message.subject ?? ""}\n${body ?? ""}`;
      if (settings.keywordScope === "subject") {
        text = message.subject ?? "";
      } else if (settings.keywordScope === "body") {
        text = body ?? "";
      }
      text = text.replaceAll(/\s+/gu, " ").toLowerCase();
      matches.push(
        settings.keywords.some((keyword) =>
          text.includes(keyword.replaceAll(/\s+/gu, " ").toLowerCase())
        )
      );
    }
    if (
      matches.length > 0 &&
      !(settings.matchMode === "all"
        ? matches.every(Boolean)
        : matches.some(Boolean))
    ) {
      continue;
    }
    if (matches.length > 0 && settings.prompt.length === 0) {
      deterministicLabelIds.push(label.id);
    } else {
      aiLabels.push(label);
    }
  }
  return { aiLabels, deterministicLabelIds };
};
