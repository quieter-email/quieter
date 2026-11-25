import { createHmac, timingSafeEqual } from "node:crypto";

import type { CallToolResult } from "@modelcontextprotocol/server";
import { serverEnv } from "@quieter/env/server";
import { z } from "zod";

export const mcpAuthorizationSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("explicit") }),
  z.object({ intent: z.literal("approved"), token: z.string().max(128) }),
  z.object({ intent: z.literal("send_without_review") }),
]);

const signApproval = (
  secret: string,
  input: { principal: string; action: string; payload: unknown },
  expiresAt: number
) =>
  createHmac("sha256", secret)
    .update("quieter:mcp-approval:v1\n")
    .update(
      JSON.stringify(
        [input.principal, input.action, expiresAt, input.payload],
        (_key, value: unknown) =>
          typeof value === "object" && value !== null && !Array.isArray(value)
            ? Object.fromEntries(
                Object.entries(value).toSorted(([a], [b]) => a.localeCompare(b))
              )
            : value
      )
    )
    .digest();

export const requireMcpApproval = (input: {
  action: string;
  authorization?: z.infer<typeof mcpAuthorizationSchema>;
  effect: "send" | "delete" | "bulk_delete" | "automation";
  payload: unknown;
  preview?: unknown;
  principal: string;
}): CallToolResult | null => {
  if (
    (input.effect === "delete" && input.authorization?.intent === "explicit") ||
    (input.effect === "send" &&
      input.authorization?.intent === "send_without_review")
  ) {
    return null;
  }

  const secret = serverEnv.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("MCP approval signing secret is not configured.");
  }
  const now = Date.now();

  if (input.authorization?.intent === "approved") {
    const match =
      /^(?<expiresAt>\d{13})\.(?<signature>[A-Za-z0-9_-]{43})$/u.exec(
        input.authorization.token
      )?.groups;
    if (match?.signature && Number(match.expiresAt) > now) {
      const expected = signApproval(secret, input, Number(match.expiresAt));
      const received = Buffer.from(match.signature, "base64url");
      if (
        received.length === expected.length &&
        timingSafeEqual(received, expected)
      ) {
        return null;
      }
    }
  }

  const expiresAt = now + 15 * 60_000;
  const token = `${expiresAt}.${signApproval(secret, input, expiresAt).toString("base64url")}`;
  const messages = {
    automation:
      "Show the user the rule, what mail it matches, and where it will forward or move those messages. Wait for approval.",
    bulk_delete:
      "Show the user exactly what will be deleted or removed. Wait for approval before repeating the same call.",
    delete:
      "Show the user exactly what will be deleted or removed. Wait for approval before repeating the same call.",
    send: "Show the user the exact message, recipients, subject, and attachments. Wait for approval before repeating the same call.",
  };
  const structuredContent = {
    action: input.action,
    authorization: { intent: "approved", token },
    expiresAt: new Date(expiresAt).toISOString(),
    message: messages[input.effect],
    preview: input.preview ?? input.payload,
    status: "approval_required",
  };
  return {
    content: [{ text: JSON.stringify(structuredContent), type: "text" }],
    structuredContent,
  };
};
