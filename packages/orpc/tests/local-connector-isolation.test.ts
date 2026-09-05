import type { MCPClient } from "@ai-sdk/mcp";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { runLinearMcpToolCallsForUser } from "../src/connectors/linear-mcp";
import { createGoogleCalendarEventForUser } from "../src/connectors/runtime";

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
vi.mock(import("@ai-sdk/mcp"), () => ({
  createMCPClient: vi.fn<() => Promise<MCPClient>>().mockResolvedValue(
    // Only tool execution and cleanup are needed by this test client.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    { callTool: mocks.callTool, close: mocks.close } as unknown as MCPClient
  ),
}));
vi.mock(import("@quieter/database/client"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    db: Object.assign(actual.db, {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => [
              {
                accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
                encryptedAccessToken: "encrypted-test",
                status: "connected",
              },
            ],
          }),
        }),
      }),
    }),
  };
});
vi.mock(import("../src/gmail-credential-crypto"), () => ({
  decryptGmailCredentialSecret: () => "test-token",
  encryptGmailCredentialSecret: vi.fn<() => string>(),
}));

const event = {
  end: { date: "2026-09-07" },
  start: { date: "2026-09-06" },
  summary: "Development test",
};

describe("independent local connector write controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.QUIETER_LOCAL_PROVIDER_MODE = "write";
    mocks.env.QUIETER_LOCAL_CALENDAR_WRITE_ACCOUNTS = undefined;
    mocks.env.QUIETER_LOCAL_LINEAR_WRITES = false;
    mocks.callTool.mockResolvedValue({ content: [] });
  });

  afterEach(() => vi.unstubAllGlobals());

  test("enabling Gmail writes does not enable Calendar writes", async () => {
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);
    await expect(
      createGoogleCalendarEventForUser({ event, userId: "test" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(request).not.toHaveBeenCalled();
  });

  test("checks the actual primary calendar before allowing a write", async () => {
    mocks.env.QUIETER_LOCAL_CALENDAR_WRITE_ACCOUNTS = "test@example.com";
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ id: "shared@example.com" }));
    vi.stubGlobal("fetch", request);
    await expect(
      createGoogleCalendarEventForUser({ event, userId: "test" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "https://www.googleapis.com/calendar/v3/calendars/primary",
      expect.not.objectContaining({ method: "POST" })
    );
  });

  test("allows only the explicitly selected calendar", async () => {
    mocks.env.QUIETER_LOCAL_CALENDAR_WRITE_ACCOUNTS = "TEST@example.com";
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: "test@example.com" }))
      .mockResolvedValueOnce(
        Response.json({ id: "test-event", summary: event.summary })
      );
    vi.stubGlobal("fetch", request);
    await expect(
      createGoogleCalendarEventForUser({ event, userId: "test" })
    ).resolves.toMatchObject({ id: "test-event", status: "success" });
    expect(request).toHaveBeenLastCalledWith(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      expect.objectContaining({ method: "POST" })
    );
  });

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
});
