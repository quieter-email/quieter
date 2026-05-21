import type { GmailSearchToolResult } from "../types";

export const parseToolArguments = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export const parseGmailSearchResult = (value: string): GmailSearchToolResult | null => {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? (parsed as GmailSearchToolResult) : null;
  } catch {
    return null;
  }
};

export const formatToolState = (state: string) => {
  switch (state) {
    case "input-streaming":
      return "preparing";
    case "input-complete":
      return "running";
    case "approval-requested":
      return "approval";
    case "approval-responded":
      return "approved";
    default:
      return state;
  }
};
