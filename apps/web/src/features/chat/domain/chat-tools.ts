import type { GmailSearchToolResult } from "../types";

export const parseToolArguments = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

export const parseGmailSearchResult = (value: string): GmailSearchToolResult | null => {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as GmailSearchToolResult)
      : null;
  } catch {
    return null;
  }
};
