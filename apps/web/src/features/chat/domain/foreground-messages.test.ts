import type { UIMessage } from "ai";
import { describe, expect, test } from "vite-plus/test";

import { needsForegroundContinuation } from "./foreground-messages";

type ForegroundTestTools = {
  modify_mail: { input: unknown; output: unknown };
  navigate: { input: unknown; output: unknown };
  send_mail: { input: unknown; output: unknown };
};

type ForegroundTestMessage = UIMessage<unknown, never, ForegroundTestTools>;

const assistantMessage = (
  parts: ForegroundTestMessage["parts"]
): ForegroundTestMessage => ({
  id: "assistant-1",
  parts,
  role: "assistant",
});

describe("foreground continuation", () => {
  test("continues after mixed terminal client tools and approvals", () => {
    expect(
      needsForegroundContinuation([
        assistantMessage([
          { type: "step-start" },
          {
            input: {},
            output: { mailbox: "sent" },
            state: "output-available",
            toolCallId: "navigate-1",
            type: "tool-navigate",
          },
          {
            approval: { approved: true, id: "approval-1" },
            input: {},
            state: "approval-responded",
            toolCallId: "send-1",
            type: "tool-send_mail",
          },
        ]),
      ])
    ).toBeTruthy();
  });

  test("waits until every tool in the current step is terminal", () => {
    expect(
      needsForegroundContinuation([
        assistantMessage([
          { type: "step-start" },
          {
            input: {},
            output: { mailbox: "sent" },
            state: "output-available",
            toolCallId: "navigate-1",
            type: "tool-navigate",
          },
          {
            input: { action: "archive" },
            state: "input-available",
            toolCallId: "archive-1",
            type: "tool-modify_mail",
          },
        ]),
      ])
    ).toBeFalsy();
  });

  test("does not continue after server-only work", () => {
    expect(
      needsForegroundContinuation([
        assistantMessage([
          { type: "step-start" },
          {
            input: {},
            output: { status: "sent" },
            state: "output-available",
            toolCallId: "send-1",
            type: "tool-send_mail",
          },
        ]),
      ])
    ).toBeFalsy();
  });

  test("uses only the latest tool step", () => {
    expect(
      needsForegroundContinuation([
        assistantMessage([
          {
            input: {},
            output: { mailbox: "inbox" },
            state: "output-available",
            toolCallId: "navigate-1",
            type: "tool-navigate",
          },
          { type: "step-start" },
          {
            input: {},
            output: { status: "sent" },
            state: "output-available",
            toolCallId: "send-1",
            type: "tool-send_mail",
          },
        ]),
      ])
    ).toBeFalsy();
  });
});
