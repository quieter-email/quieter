import { parseFragment } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

import type { MessageListItem } from "../messages";
import { buildComposeMessageQuotes } from "./message-quote";
import type { ComposeQuoteSource } from "./message-quote";
import type { ComposeDraftAnchor } from "./schema";
import {
  getUnresolvedSnippetFields,
  getVisibleHtmlText,
} from "./snippet-variables";

// This projection is for validation only, never outgoing message content.
export const getAuthoredSnippetContent = (
  input: {
    bodyHtml?: string;
    bodyText?: string;
    draftAnchor?: ComposeDraftAnchor | null;
  },
  source: ComposeQuoteSource & Pick<MessageListItem, "id" | "threadId">
): { authoredBodyHtml: string; authoredBodyText: string } => {
  const bodyHtml = input.bodyHtml ?? "";
  const bodyText = input.bodyText ?? "";
  if (
    input.draftAnchor?.sourceMessageId !== source.id ||
    input.draftAnchor.sourceThreadId !== source.threadId
  ) {
    return { authoredBodyHtml: bodyHtml, authoredBodyText: bodyText };
  }
  const quotes = buildComposeMessageQuotes(source);
  const forwarding = input.draftAnchor.seededBy === "forward";
  const quoteHtml = forwarding ? quotes.forwardHtml : quotes.replyHtml;
  const quoteText = forwarding ? quotes.forwardText : quotes.replyText;
  const expected = parseFragment(quoteHtml, { scriptingEnabled: false });
  const actual = parseFragment(bodyHtml, { scriptingEnabled: false });
  const nodes = actual.childNodes.filter(
    (node) => "tagName" in node || ("value" in node && node.value.trim() !== "")
  );
  const expectedNodes = expected.childNodes.filter(
    (node) => "tagName" in node || ("value" in node && node.value.trim() !== "")
  );
  const expectedText = getVisibleHtmlText(expectedNodes)
    .replaceAll(/\s+/gu, " ")
    .trim();
  const formattedDate = quotes.formattedDate.replaceAll(/\s+/gu, " ").trim();
  const dateStart = formattedDate ? expectedText.indexOf(formattedDate) : -1;
  const matches: {
    authoredDate?: string;
    nodes: DefaultTreeAdapterMap["childNode"][];
    quoteText: string;
  }[] = [];
  for (
    let index = 0;
    index <= nodes.length - expectedNodes.length;
    index += 1
  ) {
    const group = nodes.slice(index, index + expectedNodes.length);
    if (
      !group.every((node, offset) => {
        const target = expectedNodes[offset];
        return (
          target !== undefined &&
          ("tagName" in node ? node.tagName : null) ===
            ("tagName" in target ? target.tagName : null)
        );
      })
    ) {
      continue;
    }
    const candidateText = getVisibleHtmlText(group)
      .replaceAll(/\s+/gu, " ")
      .trim();
    if (candidateText === expectedText) {
      matches.push({ nodes: group, quoteText });
      continue;
    }
    if (
      dateStart === -1 ||
      expectedText.includes(formattedDate, dateStart + formattedDate.length) ||
      getUnresolvedSnippetFields({ bodyText: formattedDate }).length > 0
    ) {
      continue;
    }
    const prefix = expectedText.slice(0, dateStart);
    const suffix = expectedText.slice(dateStart + formattedDate.length);
    if (!candidateText.startsWith(prefix) || !candidateText.endsWith(suffix)) {
      continue;
    }
    const candidateDate = candidateText.slice(
      prefix.length,
      candidateText.length - suffix.length
    );
    if (
      candidateDate.length > 0 &&
      getUnresolvedSnippetFields({ bodyText: candidateDate }).length === 0
    ) {
      matches.push({
        authoredDate: candidateDate,
        nodes: group,
        quoteText: quoteText.replace(quotes.formattedDate, candidateDate),
      });
    }
  }
  const [match] = matches;
  if (match === undefined || matches.length !== 1) {
    return { authoredBodyHtml: bodyHtml, authoredBodyText: bodyText };
  }
  const excluded = new Set(match.nodes);
  const authoredText: string[] = [];
  const htmlProjection: string[] = [];
  const initialProjection: string[] = [];
  for (const node of actual.childNodes) {
    const text = getVisibleHtmlText([node]);
    htmlProjection.push(text);
    if (excluded.has(node)) {
      authoredText.push("\n");
      if (node === match.nodes[0]) {
        authoredText.push(`\n${match.authoredDate ?? ""}\n`);
        initialProjection.push(`\n${match.quoteText}\n`);
      }
    } else {
      authoredText.push(text);
      initialProjection.push(text);
    }
  }
  const normalizedText = bodyText.replaceAll(/\s+/gu, " ").trim();
  const provenText = [htmlProjection, initialProjection].some(
    (projection) =>
      projection.join("").replaceAll(/\s+/gu, " ").trim() === normalizedText
  );
  const visibleAuthored = authoredText.join("");
  return {
    authoredBodyHtml: `<pre>${visibleAuthored
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")}</pre>`,
    authoredBodyText: provenText ? visibleAuthored : bodyText,
  };
};
