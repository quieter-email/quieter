import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { createLinearChatTools } from "../src/chat/linear-tools";
import {
  isMutatingLinearMcpTool,
  listLinearMcpToolsForUser,
  runLinearMcpToolCallsForUser,
} from "../src/connectors/linear-mcp";

vi.mock(import("../src/connectors/linear-mcp"), () => ({
  isMutatingLinearMcpTool: vi.fn<(input: { name: string }) => boolean>(
    ({ name }: { name: string }) =>
      !["get_", "list_", "search_"].some((prefix) => name.startsWith(prefix))
  ),
  listLinearMcpToolsForUser: vi.fn<typeof listLinearMcpToolsForUser>(),
  runLinearMcpToolCallsForUser: vi.fn<typeof runLinearMcpToolCallsForUser>(),
}));

type LinearChatTools = ReturnType<typeof createLinearChatTools>;

const invokeTool = async (
  tools: LinearChatTools,
  name: string,
  args: unknown
) => {
  const tool = tools[name];
  if (tool?.execute === undefined) {
    throw new Error(`Expected executable tool ${name}`);
  }
  const result: unknown = await tool.execute(args, {
    abortSignal: undefined,
    context: undefined,
    messages: [],
    toolCallId: `call-${name}`,
  });
  return result;
};

describe("chat Linear tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("does not touch Linear for an unrequested chat", async () => {
    const tools = createLinearChatTools({
      latestUserRequest: "Summarize my inbox.",
      userId: "user-1",
    });

    expect(Object.keys(tools)).toStrictEqual([
      "linear_list_tools",
      "linear_read",
    ]);

    await invokeTool(tools, "linear_list_tools", {});

    expect(listLinearMcpToolsForUser).not.toHaveBeenCalled();
    expect(runLinearMcpToolCallsForUser).not.toHaveBeenCalled();
  });

  test("connects only when an explicitly requested Linear tool executes", async () => {
    vi.mocked(listLinearMcpToolsForUser).mockResolvedValue([
      { name: "list_teams" },
    ]);
    vi.mocked(runLinearMcpToolCallsForUser).mockResolvedValue([
      {
        durationMs: 1,
        output: { teams: [] },
        status: "success",
        toolName: "list_teams",
      },
    ]);
    const tools = createLinearChatTools({
      latestUserRequest: "Use @Linear to find my teams.",
      userId: "user-1",
    });

    expect(listLinearMcpToolsForUser).not.toHaveBeenCalled();
    expect(runLinearMcpToolCallsForUser).not.toHaveBeenCalled();
    expect(tools.linear_write).toBeDefined();

    await invokeTool(tools, "linear_list_tools", {});
    expect(listLinearMcpToolsForUser).toHaveBeenCalledWith({
      signal: undefined,
      userId: "user-1",
    });

    await invokeTool(tools, "linear_read", {
      arguments: {},
      toolName: "list_teams",
    });
    expect(runLinearMcpToolCallsForUser).toHaveBeenCalledWith({
      calls: [{ arguments: {}, toolName: "list_teams" }],
      maxCalls: 1,
      signal: undefined,
      userId: "user-1",
    });
  });

  test("does not allow a read proxy to bypass write approval", async () => {
    const tools = createLinearChatTools({
      latestUserRequest: "Use @Linear to create an issue.",
      userId: "user-1",
    });

    const result = await invokeTool(tools, "linear_read", {
      arguments: {},
      toolName: "create_issue",
    });

    expect(result).toStrictEqual({
      error: "Use linear_write for this Linear tool.",
      status: "error",
    });
    expect(runLinearMcpToolCallsForUser).not.toHaveBeenCalled();
    expect(isMutatingLinearMcpTool).toHaveBeenCalledWith({
      name: "create_issue",
    });
  });
});
