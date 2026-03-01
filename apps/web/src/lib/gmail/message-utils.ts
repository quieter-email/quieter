import type { MessageListItem } from "./gmail";

export const getParsedMessageDate = (message: MessageListItem) => {
  const source = message.internalDate ?? message.date;
  if (!source) return null;

  const numeric = Number(source);
  const parsed = Number.isFinite(numeric) ? new Date(numeric) : new Date(source);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const formatMessageDate = (message: MessageListItem, format: "compact" | "full") => {
  const parsed = getParsedMessageDate(message);
  if (!parsed) return "";

  return new Intl.DateTimeFormat(
    undefined,
    format === "compact"
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "long", timeStyle: "short" },
  ).format(parsed);
};

export const parseSender = (from?: string) => {
  if (!from) return { name: "", email: "", display: "" };

  const display = from.trim();
  const match = display.match(/^(.*?)(?:<([^>]+)>)?$/);
  const rawName = match?.[1]?.replaceAll('"', "").trim() ?? "";
  const email = match?.[2]?.trim() ?? (display.includes("@") ? display : "");
  const name = rawName && rawName !== email ? rawName : "";

  return { name, email, display };
};
