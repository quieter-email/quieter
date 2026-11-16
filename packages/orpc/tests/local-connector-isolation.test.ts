/* oxlint-disable eslint/require-await -- MCP and guard doubles preserve asynchronous service boundaries. */
import type { MCPClient, MCPTransport } from "@ai-sdk/mcp";
import type * as McpModule from "@ai-sdk/mcp";
import { ORPCError } from "@orpc/server";
import type * as DatabaseClientModule from "@quieter/database/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import {
  isMutatingLinearMcpTool,
  runLinearMcpToolCallsForUser,
} from "../src/connectors/linear-mcp";

const mocks = vi.hoisted(() => {
  const env: {
    QUIETER_LOCAL_CALENDAR_WRITE_ACCOUNTS: string | undefined;
    QUIETER_LOCAL_LINEAR_WRITES: boolean;
    QUIETER_LOCAL_PROVIDER_MODE: "write" | "observe";
  } = {
    QUIETER_LOCAL_CALENDAR_WRITE_ACCOUNTS: undefined,
    QUIETER_LOCAL_LINEAR_WRITES: false,
    QUIETER_LOCAL_PROVIDER_MODE: "write",
  };
  return {
    callTool: vi.fn<MCPClient["callTool"]>(),
    close: vi.fn<MCPClient["close"]>(),
    env,
    listTools: vi.fn<MCPClient["listTools"]>(),
    status: "connected",
  };
});

vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    requireServerEnv: () => "test-key",
    serverEnv: {
      ...actual.serverEnv,
      QUIETER_DEPLOYMENT_ENV: "local" as const,
      get QUIETER_LOCAL_CALENDAR_WRITE_ACCOUNTS() {
        return mocks.env.QUIETER_LOCAL_CALENDAR_WRITE_ACCOUNTS;
      },
      get QUIETER_LOCAL_LINEAR_WRITES() {
        return mocks.env.QUIETER_LOCAL_LINEAR_WRITES;
      },
      get QUIETER_LOCAL_PROVIDER_MODE() {
        return mocks.env.QUIETER_LOCAL_PROVIDER_MODE;
      },
    },
  };
});
// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("@ai-sdk/mcp", async (importOriginal) => {
  const actual = await importOriginal<typeof McpModule>();
  const { z } = await import("zod");
  return {
    ...actual,
    createMCPClient: async () => {
      const transport: MCPTransport = {
        close: async () => {
          await mocks.close();
          transport.onclose?.();
        },
        send: async (message) => {
          if (!("method" in message) || !("id" in message)) {
            return;
          }
          let result: Record<string, unknown>;
          switch (message.method) {
            case "initialize": {
              result = {
                capabilities: { tools: {} },
                protocolVersion: "2025-11-25",
                serverInfo: { name: "test-connector", version: "1" },
              };
              break;
            }
            case "tools/list": {
              result = await mocks.listTools();
              break;
            }
            case "tools/call": {
              const args = z
                .object({
                  arguments: z.record(z.string(), z.unknown()).optional(),
                  name: z.string(),
                })
                .parse(message.params);
              result = await mocks.callTool(args);
              break;
            }
            default: {
              throw new Error(`Unexpected connector method ${message.method}`);
            }
          }
          transport.onmessage?.({ id: message.id, jsonrpc: "2.0", result });
        },
        start: async () => {
          await Promise.resolve();
        },
      };
      return await actual.createMCPClient({ transport });
    },
  };
});
// This fake implements only the database operations exercised by the test.
// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("@quieter/database/client", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  const reader = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => [
            {
              accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
              connectionId: "connection-owned",
              encryptedAccessToken: "encrypted-test",
              provider: "linear",
              scopes: "read write",
              status: mocks.status,
            },
          ],
        }),
      }),
    }),
  };
  return {
    ...actual,
    db: {
      select: reader.select,
      transaction: async <Result>(
        run: (database: typeof reader) => Promise<Result>
      ) => await run(reader),
    },
  };
});
vi.mock(import("../src/gmail-credential-crypto"), () => ({
  decryptGmailCredentialSecret: () => "test-token",
  encryptGmailCredentialSecret: vi.fn<() => string>(),
}));

describe("independent local connector write controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.QUIETER_LOCAL_PROVIDER_MODE = "write";
    mocks.env.QUIETER_LOCAL_CALENDAR_WRITE_ACCOUNTS = undefined;
    mocks.env.QUIETER_LOCAL_LINEAR_WRITES = false;
    mocks.status = "connected";
    mocks.callTool.mockResolvedValue({ content: [] });
    mocks.listTools.mockResolvedValue({
      tools: [
        ...[
          "list_teams",
          "create_issue",
          "get_issue",
          "get_project",
          "get_user",
          "get_export_private_data",
        ].map((name) => ({
          inputSchema: {
            additionalProperties: false,
            properties: {},
            type: "object",
          },
          name,
        })),
        {
          inputSchema: {
            additionalProperties: false,
            properties: { query: { type: "string" } },
            required: ["query"],
            type: "object",
          },
          name: "search_issues",
        },
      ],
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  test("Linear reads work while writes remain independently disabled", async () => {
    const results = await runLinearMcpToolCallsForUser({
      calls: [{ toolName: "list_teams" }, { toolName: "create_issue" }],
      userId: "test",
    });
    expect(results.map(({ status }) => status)).toStrictEqual([
      "success",
      "error",
    ]);
    expect(mocks.callTool).toHaveBeenCalledExactlyOnceWith({
      arguments: {},
      name: "list_teams",
    });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  test("Linear batches run in order, retain failures and respect the call limit", async () => {
    let completed = 0;
    mocks.callTool.mockImplementation(async ({ name }) => {
      const predecessor = completed;
      await Promise.resolve();
      expect(completed).toBe(predecessor);
      completed += 1;
      if (name === "get_project") {
        throw new Error("Provider failed");
      }
      return { content: [{ text: String(completed), type: "text" }] };
    });
    const results = await runLinearMcpToolCallsForUser({
      calls: ["get_issue", "get_project", "get_user", "get_excluded"].map(
        (toolName) => ({ toolName })
      ),
      maxCalls: 3,
      userId: "test",
    });
    expect(completed).toBe(3);
    expect(results).toMatchObject([
      { output: { content: [{ text: "1" }] }, toolName: "get_issue" },
      { error: "Provider failed", status: "error", toolName: "get_project" },
      { output: { content: [{ text: "3" }] }, toolName: "get_user" },
    ]);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  test("Linear writes require both explicit controls", async () => {
    mocks.env.QUIETER_LOCAL_LINEAR_WRITES = true;
    mocks.env.QUIETER_LOCAL_PROVIDER_MODE = "observe";
    const input = { calls: [{ toolName: "create_issue" }], userId: "test" };
    const blocked = await runLinearMcpToolCallsForUser(input);
    expect(blocked[0]?.status).toBe("error");
    expect(mocks.callTool).not.toHaveBeenCalled();
    mocks.env.QUIETER_LOCAL_PROVIDER_MODE = "write";
    const allowed = await runLinearMcpToolCallsForUser(input);
    expect(allowed[0]?.status).toBe("success");
    expect(mocks.callTool).toHaveBeenCalledOnce();
  });

  test("an unfamiliar read-like name cannot bypass local write isolation", async () => {
    expect(
      isMutatingLinearMcpTool({ name: "get_export_private_data" })
    ).toBeTruthy();
    const result = await runLinearMcpToolCallsForUser({
      calls: [{ toolName: "get_export_private_data" }],
      userId: "test",
    });
    expect(result[0]?.status).toBe("error");
    expect(mocks.callTool).not.toHaveBeenCalled();
  });

  test("a policy changed during discovery blocks writes while reads remain available", async () => {
    mocks.env.QUIETER_LOCAL_LINEAR_WRITES = true;
    const started = Promise.withResolvers<boolean>();
    const release = Promise.withResolvers<boolean>();
    let blocked = false;
    const discovery = await mocks.listTools();
    mocks.listTools.mockImplementation(async () => {
      started.resolve(true);
      await release.promise;
      return discovery;
    });
    const result = runLinearMcpToolCallsForUser({
      beforeEffect: async () => {
        if (blocked) {
          throw new ORPCError("FORBIDDEN");
        }
      },
      calls: [{ toolName: "get_issue" }, { toolName: "create_issue" }],
      connectionId: "connection-owned",
      userId: "test",
    });
    await started.promise;
    blocked = true;
    release.resolve(true);
    await expect(result).resolves.toMatchObject([
      { status: "success", toolName: "get_issue" },
      { status: "error", toolName: "create_issue" },
    ]);
    expect(mocks.callTool.mock.calls.map(([call]) => call.name)).toStrictEqual([
      "get_issue",
    ]);
  });

  test("a disconnected account cannot reuse credentials resolved before discovery", async () => {
    mocks.env.QUIETER_LOCAL_LINEAR_WRITES = true;
    const discovery = await mocks.listTools();
    mocks.listTools.mockImplementation(async () => {
      mocks.status = "needs_reconnect";
      return discovery;
    });
    await expect(
      runLinearMcpToolCallsForUser({
        calls: [{ toolName: "create_issue" }],
        connectionId: "connection-owned",
        userId: "test",
      })
    ).resolves.toMatchObject([{ status: "error" }]);
    expect(mocks.callTool).not.toHaveBeenCalled();
  });

  test("an account disconnected during caller preparation cannot dispatch a Linear write", async () => {
    mocks.env.QUIETER_LOCAL_LINEAR_WRITES = true;
    const started = Promise.withResolvers<boolean>();
    const release = Promise.withResolvers<boolean>();
    const result = runLinearMcpToolCallsForUser({
      calls: [{ toolName: "create_issue" }],
      connectionId: "connection-owned",
      prepareEffect: async () => {
        started.resolve(true);
        await release.promise;
      },
      userId: "test",
    });
    await started.promise;
    mocks.status = "needs_reconnect";
    release.resolve(true);
    await expect(result).resolves.toMatchObject([{ status: "error" }]);
    expect(mocks.callTool).not.toHaveBeenCalled();
  });

  test.each([
    { arguments: {}, toolName: "get_missing_from_discovery" },
    {
      arguments: { query: { injected: "PRIVATE_MAIL_SENTINEL" } },
      toolName: "search_issues",
    },
  ])(
    "rejects unavailable tools and schema-invalid arguments before dispatch (%j)",
    async (call) => {
      await expect(
        runLinearMcpToolCallsForUser({ calls: [call], userId: "test" })
      ).rejects.toThrow(/available|Invalid input/iu);
      expect(mocks.callTool).not.toHaveBeenCalled();
      expect(mocks.close).toHaveBeenCalledOnce();
    }
  );
});
