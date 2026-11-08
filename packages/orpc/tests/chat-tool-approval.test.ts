import {
  foregroundSnapshotSchema,
  requiresChatToolApproval,
} from "@quieter/ai/chat-tools";
import type { ChatMessagePart } from "@quieter/database/schema";
import { describe, expect, test } from "vite-plus/test";

import { assertExactChatToolApproval } from "../src/chat/tool-approval";

const foreground = foregroundSnapshotSchema.parse({
  capabilities: ["modify_mail"],
  exchangeId: "c3fba506-9b51-4e52-88b4-364f3b6c0e58",
  expiresAt: Date.now() + 60_000,
  generation: 1,
  tabId: "tab-1",
});
const proposed = {
  input: {
    arguments: { labels: ["a", "b"], target: "item-1" },
    connectionId: "account-1",
    toolName: "delete_issue",
  },
  toolCallId: "call-1",
  type: "tool-linear_write",
};
const approved: ChatMessagePart = {
  ...proposed,
  approval: { approved: true, id: "approval-1" },
  foreground,
  state: "approval-responded",
};

describe("destructive-only chat approval", () => {
  test.each([
    "delete_issue",
    "linear_delete_project",
    "purge_workspace",
    "reset_workspace",
    "remove_member",
    "destroy_project",
  ])("requires confirmation for %s across connected accounts", (toolName) => {
    for (const proxy of ["linear_write", "connector_write"]) {
      expect(
        requiresChatToolApproval({
          input: { toolName },
          toolName: proxy,
        })
      ).toBeTruthy();
    }
  });

  test.each([
    { state: "approval-requested" },
    { approval: { approved: false, id: "approval-1" } },
    { state: "output-error" },
    { state: "output-available" },
    { toolCallId: "another-call" },
    { type: "tool-modify_mail" },
    { foreground: { ...foreground, expiresAt: Date.now() - 1 } },
    { foreground: { ...foreground, generation: 2 } },
  ])("rejects an unapproved, consumed or foreign action %#", (change) => {
    expect(() => {
      assertExactChatToolApproval({
        approvedPart: { ...approved, ...change },
        exchangeId: foreground.exchangeId,
        foreground,
        proposedPart: proposed,
      });
    }).toThrow(/approve/iu);
  });

  test.each([
    { ...proposed.input, connectionId: "another-account" },
    { ...proposed.input, toolName: "delete_project" },
    {
      ...proposed.input,
      arguments: { labels: ["a", "b"], target: "another-item" },
    },
    { ...proposed.input, arguments: { labels: ["b", "a"], target: "item-1" } },
    {
      ...proposed.input,
      arguments: { extra: true, labels: ["a", "b"], target: "item-1" },
    },
  ])("rejects a changed provider, target or nested argument %#", (input) => {
    expect(() => {
      assertExactChatToolApproval({
        approvedPart: approved,
        exchangeId: foreground.exchangeId,
        foreground,
        proposedPart: { ...proposed, input },
      });
    }).toThrow(/approve/iu);
  });

  test("accepts the reviewed action independent of object key order", () => {
    const reorderedInput: unknown = JSON.parse(
      '{"toolName":"delete_issue","connectionId":"account-1","arguments":{"target":"item-1","labels":["a","b"]}}'
    );
    expect(() => {
      assertExactChatToolApproval({
        approvedPart: approved,
        exchangeId: foreground.exchangeId,
        foreground,
        proposedPart: { ...proposed, input: reorderedInput },
      });
    }).not.toThrow();
  });

  test("rejects an approval from an older exchange", () => {
    expect(() => {
      assertExactChatToolApproval({
        approvedPart: approved,
        exchangeId: "another-exchange",
        foreground,
        proposedPart: proposed,
      });
    }).toThrow(/approve/iu);
  });
});
