import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import { ORPCError } from "@orpc/server";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import type { ControlAuthorizationServices } from "@quieter/orpc/control/authority";
import { controlContracts } from "@quieter/orpc/control/contracts";
import {
  CONTROL_API_VERSION,
  CONTROL_API_VERSION_HEADER,
} from "@quieter/orpc/control/openapi";
import type { ControlTarget } from "@quieter/orpc/control/registry";
import { createControlReadRuntime } from "@quieter/orpc/control/runtime";
import type { ControlReadServices } from "@quieter/orpc/control/runtime";
import { describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";

import {
  handleManagementMcpRequest,
  MANAGEMENT_MCP_TARGET_HEADER,
} from "./management-mcp.server";

const mailboxTarget = {
  kind: "mailbox",
  mailboxId: "mailbox-a",
  organizationId: "team-a",
} satisfies ControlTarget;
const calendarTarget = {
  connectionId: "connection-a",
  kind: "calendar",
} satisfies ControlTarget;

const createFixture = () => {
  const authorizationServices = {
    assertCalendarAccess: vi
      .fn<ControlAuthorizationServices["assertCalendarAccess"]>()
      .mockResolvedValue(),
    assertOrganizationAccess: vi
      .fn<ControlAuthorizationServices["assertOrganizationAccess"]>()
      .mockResolvedValue(),
    getMailboxAccess: vi
      .fn<ControlAuthorizationServices["getMailboxAccess"]>()
      .mockResolvedValue({
        capabilities: getMailboxCapabilities({
          provider: "managed",
          role: "reader",
        }),
        organizationId: "team-a",
      }),
    getSession: vi
      .fn<ControlAuthorizationServices["getSession"]>()
      .mockResolvedValue({
        expiresAt: new Date(Date.now() + 60_000),
        sessionId: "session-a",
        userId: "user-a",
      }),
  } satisfies ControlAuthorizationServices;
  const message = {
    attachments: [
      {
        attachmentId: "attachment-a",
        fileName: "notes.txt",
        mimeType: "text/plain",
        size: 10,
      },
    ],
    bodyText: "Current authorized message.",
    id: "message-a",
    inlineImages: [
      {
        attachmentId: "inline-a",
        contentId: "inline-content",
        fileName: "photo.png",
        mimeType: "image/png",
        size: 12,
      },
    ],
    isImportant: true,
    isUnread: false,
    replyTo: "reply@example.test",
    senderAvatarUrls: {
      dark: "https://example.test/dark.png",
      light: "https://example.test/light.png",
    },
    threadId: "thread-a",
    threadMessageCount: 2,
    unsubscribeStatus: "requested" as const,
  };
  const services = {
    "calendar.accounts": vi
      .fn<ControlReadServices["calendar.accounts"]>()
      .mockResolvedValue({
        accounts: [],
        googleConfigured: true,
        isConfigured: true,
        microsoftConfigured: false,
      }),
    "calendar.event": vi
      .fn<ControlReadServices["calendar.event"]>()
      .mockRejectedValue(new ORPCError("NOT_FOUND")),
    "calendar.events": vi
      .fn<ControlReadServices["calendar.events"]>()
      .mockResolvedValue({ events: [] }),
    "calendar.list": vi
      .fn<ControlReadServices["calendar.list"]>()
      .mockResolvedValue({ calendars: [] }),
    "mail.read_thread": vi
      .fn<ControlReadServices["mail.read_thread"]>()
      .mockResolvedValue({ messages: [message], threadId: "thread-a" }),
    "mail.search": vi
      .fn<ControlReadServices["mail.search"]>()
      .mockResolvedValue({
        messages: [message],
        nextPageToken: "next-page",
        resultSizeEstimate: 3,
      }),
    "mailboxes.list": vi
      .fn<ControlReadServices["mailboxes.list"]>()
      .mockResolvedValue({ defaultMailboxId: null, groups: [] }),
  } satisfies ControlReadServices;
  const options = {
    reportError: vi.fn<(error: Error) => void>(),
    runtime: createControlReadRuntime({ authorizationServices, services }),
    scheduleBackgroundTask: vi.fn<(task: Promise<unknown>) => void>(),
  };
  return { authorizationServices, message, options, services };
};
type Fixture = ReturnType<typeof createFixture>;

const mcpRequest = (
  body: unknown,
  target: ControlTarget = mailboxTarget,
  init: RequestInit & { duplex?: "half" } = {}
) => {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    cookie: "session=synthetic-session",
    [CONTROL_API_VERSION_HEADER]: CONTROL_API_VERSION,
    [MANAGEMENT_MCP_TARGET_HEADER]: JSON.stringify(target),
  });
  for (const [name, value] of new Headers(init.headers)) {
    headers.set(name, value);
  }
  return new Request("https://app.example.test/api/management-mcp", {
    ...init,
    body: init.body ?? JSON.stringify(body),
    headers,
    method: init.method ?? "POST",
  });
};

const readPayload = async (response: Response): Promise<unknown> => {
  const body = await response.text();
  const payload =
    response.headers.get("content-type")?.includes("text/event-stream") === true
      ? body
          .split("\n")
          .findLast((line) => line.startsWith("data:"))
          ?.slice(5)
          .trim()
      : body;
  if (!payload) {
    throw new Error("Expected an MCP response message.");
  }
  const parsed: unknown = JSON.parse(payload);
  return parsed;
};

const toolResultSchema = z.object({
  result: z.object({
    content: z.array(z.object({ text: z.string(), type: z.string() })),
    isError: z.boolean().optional(),
    structuredContent: z.record(z.string(), z.unknown()).optional(),
  }),
});
const catalogSchema = z.object({
  operations: z.array(
    z.object({
      id: z.string(),
      inputSchema: z.unknown().optional(),
      outputSchema: z.unknown().optional(),
      target: z.string(),
    })
  ),
});

const callTool = async (
  fixture: Fixture,
  name: string,
  args: unknown,
  target: ControlTarget = mailboxTarget
) => {
  const response = await handleManagementMcpRequest(
    mcpRequest(
      {
        id: 1,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: args, name },
      },
      target
    ),
    fixture.options
  );
  return {
    response,
    ...toolResultSchema.parse(await readPayload(response)).result,
  };
};

describe("management MCP transport", () => {
  test("initializes without a retained session and advertises only two read tools", async () => {
    const fixture = createFixture();
    const initialized = await handleManagementMcpRequest(
      mcpRequest({
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          capabilities: {},
          clientInfo: { name: "synthetic-client", version: "1.0" },
          protocolVersion: "2025-03-26",
        },
      }),
      fixture.options
    );
    expect(initialized.status).toBe(200);
    expect(initialized.headers.has("mcp-session-id")).toBeFalsy();
    expect(initialized.headers.get(CONTROL_API_VERSION_HEADER)).toBe(
      CONTROL_API_VERSION
    );
    expect(initialized.headers.get("cache-control")).toMatch(
      /private.*no-store/u
    );
    const response = await handleManagementMcpRequest(
      mcpRequest({ id: 2, jsonrpc: "2.0", method: "tools/list" }),
      fixture.options
    );
    const body = z
      .object({
        result: z.object({
          tools: z.array(
            z.object({
              annotations: z.object({ readOnlyHint: z.boolean() }),
              name: z.string(),
            })
          ),
        }),
      })
      .parse(await readPayload(response));
    expect(body.result.tools.map((tool) => tool.name)).toStrictEqual([
      "discover_operations",
      "run_operation",
    ]);
    expect(
      body.result.tools.every((tool) => tool.annotations.readOnlyHint)
    ).toBeTruthy();
  });

  test("returns compact target-specific discovery and loads exact shared schemas only on request", async () => {
    const fixture = createFixture();
    const user = await callTool(
      fixture,
      "discover_operations",
      {},
      { kind: "user" }
    );
    expect(
      catalogSchema
        .parse(user.structuredContent)
        .operations.map((operation) => operation.id)
    ).toStrictEqual(["mailboxes.list", "calendar.accounts"]);
    const compact = await callTool(fixture, "discover_operations", {});
    const { operations } = catalogSchema.parse(compact.structuredContent);
    expect(operations.map((operation) => operation.id)).toStrictEqual([
      "mail.search",
      "mail.read_thread",
    ]);
    expect(
      operations.every(
        (operation) =>
          operation.inputSchema === undefined &&
          operation.outputSchema === undefined
      )
    ).toBeTruthy();
    const full = await callTool(fixture, "discover_operations", {
      schemaOperationIds: ["mail.read_thread"],
    });
    const schema = catalogSchema
      .parse(full.structuredContent)
      .operations.find((operation) => operation.id === "mail.read_thread");
    expect(schema?.inputSchema).toStrictEqual(
      z.toJSONSchema(controlContracts["mail.read_thread"].input, {
        io: "input",
      })
    );
    expect(schema?.outputSchema).toStrictEqual(
      z.toJSONSchema(controlContracts["mail.read_thread"].output)
    );
    const hidden = await callTool(fixture, "discover_operations", {
      schemaOperationIds: ["calendar.events"],
    });
    expect(hidden.isError).toBeTruthy();
    expect(hidden.structuredContent).not.toHaveProperty("operations");
  });

  test.each(["mail.search", "mail.read_thread"] as const)(
    "preserves complete enriched results through %s",
    async (operation) => {
      const fixture = createFixture();
      const parameters =
        operation === "mail.search"
          ? {
              category: "inbox",
              mailboxId: "mailbox-a",
              organizationId: "team-a",
              pageToken: "previous-page",
              query: "subject:notes",
            }
          : {
              mailboxId: "mailbox-a",
              organizationId: "team-a",
              threadId: "thread-a",
            };
      const result = await callTool(fixture, "run_operation", {
        operation,
        parameters,
      });
      expect(result.isError).not.toBeTruthy();
      const output = controlContracts[operation].output.parse(
        result.structuredContent?.result
      );
      expect(output.messages[0]).toMatchObject({
        ...fixture.message,
        source: {
          mailboxId: "mailbox-a",
          messageId: "message-a",
          threadId: "thread-a",
        },
      });
      const source = new URL(
        output.messages[0]?.source.href ?? "",
        "https://app.example.test"
      );
      expect(source.searchParams.get("mailboxId")).toBe("mailbox-a");
      expect(fixture.services[operation]).toHaveBeenCalledWith(
        expect.objectContaining({ parameters })
      );
      const invocation = fixture.services[operation].mock.calls.at(-1)?.[0];
      expect(invocation?.context.signal).toBeInstanceOf(AbortSignal);
      expect(invocation?.context.scheduleBackgroundTask).toBe(
        fixture.options.scheduleBackgroundTask
      );
      expect(
        fixture.authorizationServices.getMailboxAccess
      ).toHaveBeenCalledWith({ mailboxId: "mailbox-a", userId: "user-a" });
    }
  );

  test.each([
    {
      mailboxId: "another-owned-mailbox",
      organizationId: "team-a",
      threadId: "thread-a",
    },
    {
      mailboxId: "mailbox-a",
      organizationId: "another-owned-team",
      threadId: "thread-a",
    },
    {
      mailboxId: "mailbox-a",
      organizationId: "team-a",
      threadId: "thread-a",
      userId: "claimed-user",
    },
  ])(
    "blocks selected mailbox scope escapes before reads",
    async (parameters) => {
      const fixture = createFixture();
      const result = await callTool(fixture, "run_operation", {
        operation: "mail.read_thread",
        parameters,
      });
      expect(result.isError).toBeTruthy();
      expect(fixture.services["mail.read_thread"]).not.toHaveBeenCalled();
    }
  );

  test("pins calendar account access and returns the complete calendar input schema", async () => {
    const fixture = createFixture();
    const schemas = await callTool(
      fixture,
      "discover_operations",
      { schemaOperationIds: ["calendar.events"] },
      calendarTarget
    );
    const schema = catalogSchema
      .parse(schemas.structuredContent)
      .operations.find((operation) => operation.id === "calendar.events");
    expect(schema?.inputSchema).toStrictEqual(
      z.toJSONSchema(controlContracts["calendar.events"].input, { io: "input" })
    );
    const forbidden = await callTool(
      fixture,
      "run_operation",
      {
        operation: "calendar.list",
        parameters: { connectionId: "another-owned-connection" },
      },
      calendarTarget
    );
    expect(forbidden.isError).toBeTruthy();
    expect(fixture.services["calendar.list"]).not.toHaveBeenCalled();
    const allowed = await callTool(
      fixture,
      "run_operation",
      {
        operation: "calendar.list",
        parameters: { connectionId: "connection-a" },
      },
      calendarTarget
    );
    expect(allowed.isError).not.toBeTruthy();
    expect(fixture.services["calendar.list"]).toHaveBeenCalledWith(
      expect.objectContaining({ parameters: { connectionId: "connection-a" } })
    );
  });

  test("rechecks grants after discovery and again at execution", async () => {
    const fixture = createFixture();
    const discovery = await callTool(fixture, "discover_operations", {});
    expect(discovery.isError).not.toBeTruthy();
    fixture.authorizationServices.getMailboxAccess.mockRejectedValue(
      new ORPCError("NOT_FOUND")
    );
    const denied = await callTool(fixture, "run_operation", {
      operation: "mail.read_thread",
      parameters: {
        mailboxId: "mailbox-a",
        organizationId: "team-a",
        threadId: "thread-a",
      },
    });
    expect(denied.isError).toBeTruthy();
    expect(fixture.services["mail.read_thread"]).not.toHaveBeenCalled();

    const race = createFixture();
    const shared = race.options.runtime;
    race.options.runtime = {
      ...shared,
      execute: async (input) => {
        race.authorizationServices.getMailboxAccess.mockRejectedValue(
          new ORPCError("NOT_FOUND")
        );
        return await shared.execute(input);
      },
    };
    const raced = await callTool(race, "run_operation", {
      operation: "mail.read_thread",
      parameters: {
        mailboxId: "mailbox-a",
        organizationId: "team-a",
        threadId: "thread-a",
      },
    });
    expect(raced.isError).toBeTruthy();
    expect(race.services["mail.read_thread"]).not.toHaveBeenCalled();
  });

  test.each(["authorization", "x-api-key", "api-key"])(
    "rejects %s credentials even with a session cookie",
    async (header) => {
      const fixture = createFixture();
      const response = await handleManagementMcpRequest(
        mcpRequest(
          { id: 1, jsonrpc: "2.0", method: "tools/list" },
          mailboxTarget,
          { headers: { [header]: "synthetic-credential" } }
        ),
        fixture.options
      );
      expect(response.status).toBe(401);
      expect(fixture.authorizationServices.getSession).not.toHaveBeenCalled();
      expect(fixture.options.reportError).not.toHaveBeenCalled();
    }
  );

  test("requires a current session for protocol discovery and cannot run mailbox operations at user scope", async () => {
    const fixture = createFixture();
    fixture.authorizationServices.getSession.mockResolvedValue(null);
    const response = await handleManagementMcpRequest(
      mcpRequest({ id: 1, jsonrpc: "2.0", method: "tools/list" }),
      fixture.options
    );
    expect(response.status).toBe(401);
    const signedIn = createFixture();
    const result = await callTool(
      signedIn,
      "run_operation",
      {
        operation: "mail.search",
        parameters: { mailboxId: "mailbox-a", organizationId: "team-a" },
      },
      { kind: "user" }
    );
    expect(result.isError).toBeTruthy();
    expect(signedIn.services["mail.search"]).not.toHaveBeenCalled();
  });

  test.each([
    "mail.set_read",
    "settings.read",
    "automation.read",
    "availability.read",
    "memory.read",
    "unknown.operation",
  ])("does not dispatch unsupported operation %s", async (operation) => {
    const fixture = createFixture();
    const result = await callTool(fixture, "run_operation", {
      operation,
      parameters: {},
    });
    expect(result.isError).toBeTruthy();
    expect(
      Object.values(fixture.services).every(
        (service) => service.mock.calls.length === 0
      )
    ).toBeTruthy();
    expect(fixture.options.reportError).not.toHaveBeenCalled();
  });

  test.each<{ headers: HeadersInit; status: number }>([
    { headers: { [CONTROL_API_VERSION_HEADER]: "" }, status: 400 },
    { headers: { [CONTROL_API_VERSION_HEADER]: "unsupported" }, status: 400 },
    { headers: { [MANAGEMENT_MCP_TARGET_HEADER]: "" }, status: 400 },
    { headers: { [MANAGEMENT_MCP_TARGET_HEADER]: "{" }, status: 400 },
    {
      headers: {
        [MANAGEMENT_MCP_TARGET_HEADER]: JSON.stringify({
          kind: "mailbox",
          mailboxId: "mailbox-a",
        }),
      },
      status: 400,
    },
    {
      headers: {
        [MANAGEMENT_MCP_TARGET_HEADER]: JSON.stringify({
          kind: "user",
          userId: "claimed-user",
        }),
      },
      status: 400,
    },
    {
      headers: {
        [MANAGEMENT_MCP_TARGET_HEADER]: JSON.stringify({
          kind: "organization",
          organizationId: "team-a",
        }),
      },
      status: 404,
    },
    { headers: { origin: "https://attacker.example.test" }, status: 403 },
    { headers: { origin: "null" }, status: 403 },
    { headers: { "content-type": "text/plain" }, status: 415 },
  ])(
    "rejects invalid transport context without reporting request details",
    async ({ headers, status }) => {
      const fixture = createFixture();
      const response = await handleManagementMcpRequest(
        mcpRequest({}, mailboxTarget, { headers }),
        fixture.options
      );
      expect(response.status).toBe(status);
      expect(response.headers.get(CONTROL_API_VERSION_HEADER)).toBe(
        CONTROL_API_VERSION
      );
      expect(response.headers.has("access-control-allow-origin")).toBeFalsy();
      expect(fixture.options.reportError).not.toHaveBeenCalled();
    }
  );

  test("accepts same-origin requests and rejects stateless session methods", async () => {
    const fixture = createFixture();
    const response = await handleManagementMcpRequest(
      mcpRequest(
        { id: 1, jsonrpc: "2.0", method: "tools/list" },
        mailboxTarget,
        { headers: { origin: "https://app.example.test" } }
      ),
      fixture.options
    );
    expect(response.status).toBe(200);
    const unsupported = await handleManagementMcpRequest(
      new Request("https://app.example.test/api/management-mcp", {
        headers: { [CONTROL_API_VERSION_HEADER]: CONTROL_API_VERSION },
        method: "GET",
      }),
      fixture.options
    );
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get("allow")).toBe("POST");
  });

  test("refuses modern subscription streams without retaining a listener", async () => {
    const fixture = createFixture();
    const response = await handleManagementMcpRequest(
      mcpRequest(
        {
          id: 1,
          jsonrpc: "2.0",
          method: "subscriptions/listen",
          params: {
            _meta: {
              [CLIENT_CAPABILITIES_META_KEY]: {},
              [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
            },
            notifications: { tools: { listChanged: true } },
          },
        },
        mailboxTarget,
        { headers: { "mcp-protocol-version": "2026-07-28" } }
      ),
      fixture.options
    );
    const result = z
      .object({ error: z.object({ code: z.number() }) })
      .parse(await readPayload(response));
    expect(result.error.code).toBeLessThan(0);
    expect(response.headers.get("content-type")).not.toContain(
      "text/event-stream"
    );
    expect(fixture.options.reportError).not.toHaveBeenCalled();
  });

  test("bounds actual streamed bytes despite a false content length and cancels excess input", async () => {
    const fixture = createFixture();
    const cancel = vi.fn<(reason?: unknown) => void>();
    const stream = new ReadableStream<Uint8Array>({
      cancel,
      pull: (controller) => {
        controller.enqueue(new Uint8Array(40_000));
      },
    });
    const request = mcpRequest({}, mailboxTarget, {
      body: stream,
      duplex: "half",
      headers: {
        ...Object.fromEntries(mcpRequest({}).headers),
        "content-length": "1",
      },
    });
    const response = await handleManagementMcpRequest(request, fixture.options);
    expect(response.status).toBe(413);
    expect(cancel.mock.calls.length).toBeGreaterThan(0);
    expect(fixture.options.reportError).not.toHaveBeenCalled();
  });

  test.each(["{", new Uint8Array([255])])(
    "rejects malformed JSON or invalid UTF-8",
    async (body) => {
      const fixture = createFixture();
      const response = await handleManagementMcpRequest(
        mcpRequest({}, mailboxTarget, { body }),
        fixture.options
      );
      expect(response.status).toBe(400);
      expect(fixture.options.reportError).not.toHaveBeenCalled();
    }
  );

  test("sanitizes unexpected failures and preserves retry headers for expected failures", async () => {
    const fixture = createFixture();
    fixture.services["mail.search"].mockRejectedValue(
      new Error("private-query provider-credential private@example.test")
    );
    const result = await callTool(fixture, "run_operation", {
      operation: "mail.search",
      parameters: {
        category: "inbox",
        mailboxId: "mailbox-a",
        organizationId: "team-a",
      },
    });
    expect(result.isError).toBeTruthy();
    expect(JSON.stringify(result)).not.toMatch(
      /private-query|provider-credential|private@example/u
    );
    expect(fixture.options.reportError).toHaveBeenCalledWith(expect.any(Error));
    expect(fixture.options.reportError.mock.calls[0]?.[0].message).not.toMatch(
      /private|provider/u
    );
    const retrying = createFixture();
    retrying.services["mail.search"].mockImplementation(async ({ context }) => {
      context.responseHeaders?.set("retry-after", "2");
      await Promise.resolve();
      throw new ORPCError("TOO_MANY_REQUESTS", {
        message: "private provider rejection",
      });
    });
    const limited = await callTool(retrying, "run_operation", {
      operation: "mail.search",
      parameters: {
        category: "inbox",
        mailboxId: "mailbox-a",
        organizationId: "team-a",
      },
    });
    expect(limited.response.headers.get("retry-after")).toBe("2");
    expect(limited.structuredContent).toMatchObject({
      error: { code: "RATE_LIMITED", retryAfterMs: 2000 },
    });
    expect(retrying.options.reportError).not.toHaveBeenCalled();
  });

  test("propagates request cancellation without reporting an unexpected failure", async () => {
    const fixture = createFixture();
    const controller = new AbortController();
    controller.abort(new Error("private cancellation reason"));
    const response = await handleManagementMcpRequest(
      mcpRequest({}, mailboxTarget, { signal: controller.signal }),
      fixture.options
    );
    expect(response.status).toBe(499);
    await expect(response.text()).resolves.not.toContain(
      "private cancellation reason"
    );
    expect(fixture.options.reportError).not.toHaveBeenCalled();
  });

  test("cancels an unfinished streamed body when the request aborts", async () => {
    const fixture = createFixture();
    const controller = new AbortController();
    const reading = Promise.withResolvers<null>();
    const cancel = vi.fn<(reason?: unknown) => void>();
    const stream = new ReadableStream<Uint8Array>(
      {
        cancel,
        pull: () => {
          reading.resolve(null);
        },
      },
      { highWaterMark: 0 }
    );
    const pending = handleManagementMcpRequest(
      mcpRequest({}, mailboxTarget, {
        body: stream,
        duplex: "half",
        signal: controller.signal,
      }),
      fixture.options
    );
    await reading.promise;
    controller.abort();
    const response = await pending;
    expect(response.status).toBe(499);
    expect(cancel.mock.calls.length).toBeGreaterThan(0);
    expect(fixture.options.reportError).not.toHaveBeenCalled();
  });
});
