import type { ChatToolApproval } from "@quieter/app/features/chat/domain/chat-tools";
import { getChatActivitySegments } from "@quieter/app/features/chat/domain/tool-activity";
import type { UIMessage } from "ai";
import { describe, expect, test, vi } from "vite-plus/test";

const searchPart: UIMessage["parts"][number] = {
  input: { query: "project update" },
  output: {
    category: "inbox",
    fetchedAt: "2026-11-06T12:00:00Z",
    messages: [
      {
        from: "Alex <alex@example.invalid>",
        id: "private-message",
        subject: "Project update",
        threadId: "private-thread",
      },
    ],
    query: "project update",
    resultSizeEstimate: 200,
    status: "success",
  },
  state: "output-available",
  toolCallId: "search",
  type: "tool-search_gmail",
};

describe("chat activity", () => {
  test("keeps grouped work stable while preserving prose, errors and approvals in order", () => {
    const input = {
      arguments: { id: "affected-item", nested: { permanent: true } },
      connectionId: "selected-account",
      toolName: "delete_item",
    };
    const approval: ChatToolApproval = {
      approve: vi.fn<() => void>(),
      deny: vi.fn<() => void>(),
      id: "approval",
      toolCallId: "delete",
      toolName: "connector_write",
    };
    const parts: UIMessage["parts"] = [
      searchPart,
      {
        input: {},
        state: "input-available",
        toolCallId: "read",
        type: "tool-read_gmail_thread",
      },
      { text: "I found the requested conversation.", type: "text" },
      {
        errorText: "The account needs to be reconnected.",
        input: {},
        state: "output-error",
        toolCallId: "failure",
        type: "tool-connector_read",
      },
      {
        approval: { id: approval.id },
        input,
        state: "approval-requested",
        toolCallId: "delete",
        type: "tool-connector_write",
      },
      {
        approval: { approved: false, id: "declined" },
        input: {},
        state: "output-denied",
        toolCallId: "skipped",
        type: "tool-modify_mail",
      },
    ];
    const segments = getChatActivitySegments({ approvals: [approval], parts });
    expect(segments.map((segment) => segment.kind)).toStrictEqual([
      "activity",
      "text",
      "failure",
      "approval",
      "activity",
    ]);
    const [first] = segments;
    expect(first?.id).toBe(
      getChatActivitySegments({ approvals: [], parts: [searchPart] })[0]?.id
    );
    if (first?.kind !== "activity") {
      throw new Error("Expected grouped activity");
    }
    expect(first.steps.map((step) => step.id)).toStrictEqual([
      "search",
      "read",
    ]);
    const confirmation = segments.find(
      (segment) => segment.kind === "approval"
    );
    expect(confirmation?.approval).toBe(approval);
    expect(confirmation?.input).toBe(input);
    const skipped = segments.at(-1);
    expect(skipped).toMatchObject({
      kind: "activity",
      steps: [{ phase: "skipped" }],
    });
  });

  test("uses returned mail evidence without exposing protocol identifiers or claiming estimated totals", () => {
    const [segment] = getChatActivitySegments({
      approvals: [],
      parts: [searchPart],
    });
    if (segment?.kind !== "activity") {
      throw new Error("Expected mail activity");
    }
    const [step] = segment.steps;
    expect(step.phase).toBe("complete");
    expect(step.sources).toContainEqual(
      expect.objectContaining({
        messageId: "private-message",
        subject: "Project update",
        threadId: "private-thread",
      })
    );
    expect([step.title, ...step.context].join(" ")).not.toMatch(
      /private-message|private-thread|200/u
    );
    const [unknown] = getChatActivitySegments({
      approvals: [],
      parts: [{ ...searchPart, output: {} }],
    });
    expect(unknown).toMatchObject({
      kind: "activity",
      steps: [{ phase: "unavailable", sources: [] }],
    });
  });

  test("keeps partial read failures visible rather than reporting ordinary success", () => {
    const [segment] = getChatActivitySegments({
      approvals: [],
      parts: [
        {
          input: { messageIds: ["unavailable"] },
          output: {
            failed: [{ error: "Unavailable", messageId: "unavailable" }],
            fetchedAt: "2026-11-06T12:00:00Z",
            messages: [],
            status: "success",
          },
          state: "output-available",
          toolCallId: "batch",
          type: "tool-read_gmail_messages",
        },
      ],
    });
    expect(segment).toMatchObject({ id: "batch", kind: "failure" });
  });
});
