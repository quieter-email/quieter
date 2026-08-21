export type ChatToolApproval = {
  approve: (editedArgs?: Record<string, unknown>) => void;
  canResolve: boolean;
  id: string;
  originalArgs: unknown;
  reject: () => void;
  status: "pending" | "validating" | "staged" | "submitting" | "error";
  toolCallId: string;
  toolName: string;
};

export const parseToolArguments = (value: unknown): Record<string, unknown> => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value));
  }
  if (typeof value !== "string") {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed))
      : {};
  } catch {
    return {};
  }
};

export const parseToolResult = (content: unknown): unknown => {
  if (typeof content !== "string") {
    return content;
  }
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return content;
  }
};

export const humanizeToolName = (name: string) =>
  name
    .replace(/^linear[-_:]?/u, "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/^./u, (character) => character.toUpperCase());
