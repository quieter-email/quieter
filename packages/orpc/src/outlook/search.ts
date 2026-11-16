import { ORPCError } from "@orpc/server";
import { parseMailSearchExpression } from "@quieter/mail/search-expression";
import type { MailSearchExpression } from "@quieter/mail/search-expression";

const translate = (node: MailSearchExpression): string => {
  if (node.type === "and" || node.type === "or") {
    return `(${translate(node.left)} ${node.type.toUpperCase()} ${translate(node.right)})`;
  }
  if (node.type === "not") {
    return `(NOT ${translate(node.operand)})`;
  }
  const value = node.type === "text" ? node.value : node.filter.value;
  if (!/^[\p{L}\p{N}\s@._+/-]+$/u.test(value)) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "This search contains characters that are not supported for this mailbox.",
    });
  }
  if (node.type === "text") {
    return `"${value}"`;
  }
  const { filter } = node;
  let translated: string;
  if (["from", "to", "cc", "bcc", "subject"].includes(filter.type)) {
    translated = `${filter.type}:"${value}"`;
  } else if (filter.type === "content") {
    translated = `body:"${value}"`;
  } else if (filter.type === "filename") {
    translated = `attachment:"${value}"`;
  } else if (filter.type === "has" && value.toLowerCase() === "attachment") {
    translated = "hasAttachments:true";
  } else if (filter.type === "after" || filter.type === "before") {
    const match =
      /^(?<year>\d{4})[/-](?<month>\d{1,2})[/-](?<day>\d{1,2})$/u.exec(value);
    const day =
      match?.groups === undefined
        ? null
        : new Date(
            Date.UTC(
              Number(match.groups.year),
              Number(match.groups.month) - 1,
              Number(match.groups.day)
            )
          );
    if (
      day === null ||
      match?.groups === undefined ||
      day.getUTCFullYear() !== Number(match.groups.year) ||
      day.getUTCMonth() !== Number(match.groups.month) - 1 ||
      day.getUTCDate() !== Number(match.groups.day)
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Use a valid calendar date in this search.",
      });
    }
    translated = `received${filter.type === "before" ? "<" : ">="}${day.toISOString().slice(0, 10)}`;
  } else {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "This search filter is not supported for this mailbox. Use text, sender, recipient, subject, date, content, or attachment filters.",
    });
  }
  return filter.negated === true ? `(NOT ${translated})` : translated;
};

export const translateOutlookSearch = (query: string): string | null => {
  let expression: MailSearchExpression | null;
  try {
    expression = parseMailSearchExpression(query);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ORPCError("BAD_REQUEST", { message: error.message });
    }
    throw error;
  }
  if (expression === null) {
    return null;
  }
  return `"${translate(expression).replaceAll('"', '\\"')}"`;
};
