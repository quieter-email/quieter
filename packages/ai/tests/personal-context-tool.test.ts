import { describe, expect, test, vi } from "vite-plus/test";

import { createPersonalContextChatTool } from "../src/chat-agent";
import type { PersonalContextToolsContext } from "../src/chat-agent";

describe("personal context read tool", () => {
  test("keeps continuation and full record contents available without approval", async () => {
    const cursor = { afterId: "memory-25", startedAt: "2026-10-18T12:00:00Z" };
    const readPersonalContext = vi
      .fn<PersonalContextToolsContext["readPersonalContext"]>()
      .mockResolvedValue({
        hasMore: true,
        items: [
          {
            content: "Detail ".repeat(1000),
            id: "memory-50",
            kind: "learned" as const,
            summary: "A remembered detail",
          },
        ],
        nextCursor: { ...cursor, afterId: "memory-50" },
        total: 63,
      });
    const tools = createPersonalContextChatTool({ readPersonalContext });
    const tool = tools.read_personal_context;
    if (!tool?.execute) {
      throw new Error("Expected the personal context read tool");
    }

    const result: unknown = await tool.execute(
      { cursor },
      {
        context: undefined,
        messages: [],
        toolCallId: "overview",
      }
    );

    expect(tool).not.toHaveProperty("needsApproval");
    expect(readPersonalContext).toHaveBeenCalledWith({ cursor });
    expect(result).toMatchObject({
      hasMore: true,
      nextCursor: { afterId: "memory-50" },
      status: "success",
      total: 63,
    });
    expect(result).toHaveProperty("items.0.content", "Detail ".repeat(1000));
  });
});
