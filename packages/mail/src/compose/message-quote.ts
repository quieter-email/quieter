import type { MessageListItem } from "../messages";
import { formatMessageDate, parseSender } from "../thread-list";

export type ComposeQuoteSource = Pick<
  MessageListItem,
  | "bodyHtml"
  | "bodyText"
  | "snippet"
  | "from"
  | "to"
  | "cc"
  | "subject"
  | "date"
  | "internalDate"
>;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const textToHtml = (value: string) =>
  value
    .split(/\r?\n/gu)
    .map((line) => (line ? escapeHtml(line) : "<br>"))
    .join("<br>");

const getMessageBodyHtml = (message: ComposeQuoteSource) => {
  const html = message.bodyHtml?.trim() ?? "";
  if (html !== "") {
    return html;
  }

  const text = message.bodyText?.trim() ?? message.snippet?.trim() ?? "";
  if (text !== "") {
    return `<p>${textToHtml(text)}</p>`;
  }
  return "<p>(No message content)</p>";
};

const getMessageBodyText = (message: ComposeQuoteSource) => {
  const text = message.bodyText?.trim() ?? message.snippet?.trim() ?? "";
  if (text !== "") {
    return text;
  }
  return "(No message content)";
};

const quotePlainText = (value: string) =>
  value
    .split(/\r?\n/gu)
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");

const buildReplyLead = (message: ComposeQuoteSource) => {
  const sender = parseSender(message.from);
  const senderDisplay = sender.display?.trim() ?? "";
  const senderEmail = sender.email?.trim() ?? "";
  let senderLabel = "Unknown sender";
  if (senderDisplay !== "") {
    senderLabel = senderDisplay;
  } else if (senderEmail !== "") {
    senderLabel = senderEmail;
  }
  const formattedDate = formatMessageDate(message, "full");
  const rawDate = message.date?.trim() ?? "";
  let sentAt = "an earlier message";
  if ((formattedDate?.trim() ?? "") !== "") {
    sentAt = formattedDate ?? sentAt;
  } else if (rawDate !== "") {
    sentAt = rawDate;
  }

  return `On ${sentAt}, ${senderLabel} wrote:`;
};

const buildForwardHeaderLines = (message: ComposeQuoteSource) => {
  const lines: string[] = [];

  const from = message.from?.trim() ?? "";
  if (from !== "") {
    lines.push(`From: ${from}`);
  }

  const sentAt =
    formatMessageDate(message, "full") ?? message.date?.trim() ?? "";
  if (sentAt !== "") {
    lines.push(`Date: ${sentAt}`);
  }

  const subject = message.subject?.trim() ?? "";
  if (subject !== "") {
    lines.push(`Subject: ${subject}`);
  }

  const to = message.to?.trim() ?? "";
  if (to !== "") {
    lines.push(`To: ${to}`);
  }

  const cc = message.cc?.trim() ?? "";
  if (cc !== "") {
    lines.push(`Cc: ${cc}`);
  }

  return lines;
};

export const buildComposeMessageQuotes = (
  message: ComposeQuoteSource
): {
  replyHtml: string;
  replyText: string;
  forwardHtml: string;
  forwardText: string;
  formattedDate: string;
} => {
  const lead = buildReplyLead(message);
  const headerLines = buildForwardHeaderLines(message);
  const headerHtml =
    headerLines.length > 0
      ? `<p data-compose-quote="headers">${headerLines
          .map((line) => {
            const separatorIndex = line.indexOf(":");
            if (separatorIndex === -1) {
              return escapeHtml(line);
            }
            const label = line.slice(0, separatorIndex + 1);
            const value = line.slice(separatorIndex + 1).trim();
            return `<strong>${escapeHtml(label)}</strong> ${escapeHtml(value)}`;
          })
          .join("<br>")}</p>`
      : "";
  const body = `<blockquote data-compose-quote="body">${getMessageBodyHtml(message)}</blockquote>`;
  return {
    formattedDate: formatMessageDate(message, "full"),
    forwardHtml: `<p data-compose-quote="forward">---------- Forwarded message ---------</p>${headerHtml}${body}`,
    forwardText: [
      "",
      "",
      "---------- Forwarded message ---------",
      ...headerLines,
      "",
      getMessageBodyText(message),
    ].join("\n"),
    replyHtml: `<p data-compose-quote="lead">${escapeHtml(lead)}</p>${body}`,
    replyText: ["", "", lead, quotePlainText(getMessageBodyText(message))].join(
      "\n"
    ),
  };
};
