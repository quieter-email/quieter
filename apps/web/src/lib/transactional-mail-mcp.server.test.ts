import { createMcpHandler } from "@modelcontextprotocol/server";
import type { McpHttpHandler } from "@modelcontextprotocol/server";
import type { SendMessageInput, SendMessageResult } from "@quieter/mail/send";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";

import type { reportServerError } from "./server-error-reporting";
import {
  buildTransactionalMailMcpServer,
  handleTransactionalMailMcpRequest,
} from "./transactional-mail-mcp.server";

type SendTransactionalMail = (input: {
  message: SendMessageInput;
  organizationId: string;
}) => Promise<SendMessageResult>;

const toolListMessageSchema = z.object({
  result: z.object({
    tools: z.array(
      z.object({
        description: z.string().optional(),
        inputSchema: z.unknown().optional(),
        name: z.string(),
      })
    ),
  }),
});

const toolCallMessageSchema = z.object({
  result: z.object({
    content: z.array(z.object({ text: z.string(), type: z.string() })),
    isError: z.boolean().optional(),
    structuredContent: z
      .object({
        idempotent: z.boolean(),
        messageId: z.string().nullable(),
        sent: z.boolean(),
      })
      .optional(),
  }),
});

const mocks = vi.hoisted(() => ({
  reportServerError: vi.fn<
    (error: unknown, boundary: string) => ReturnType<typeof reportServerError>
  >(() => {}),
  resolveOrganizationId: vi.fn<(request: Request) => Promise<string | null>>(),
}));

vi.mock(import("./server-error-reporting"), () => ({
  reportServerError: mocks.reportServerError,
}));
vi.mock(import("./organization-api-auth.server"), () => ({
  getOrganizationApiKeyOrganizationId: mocks.resolveOrganizationId,
}));

const createTestHandler = (
  sendTransactionalMail: SendTransactionalMail
): McpHttpHandler =>
  createMcpHandler(() =>
    buildTransactionalMailMcpServer({
      organizationId: "team-a",
      sendTransactionalMail,
    })
  );

const mcpRequest = (body: Record<string, unknown>) =>
  new Request("https://quieter.email/api/v1/mcp", {
    body: JSON.stringify(body),
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    method: "POST",
  });

const postMcp = async (
  handler: McpHttpHandler,
  body: Record<string, unknown>
): Promise<Response> => await handler.fetch(mcpRequest(body));

const readMcpPayload = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("text/event-stream")
    ? text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .at(-1)
    : text;
  if (payload === undefined || payload === "") {
    throw new Error("The MCP response did not contain a message.");
  }
  const parsed: unknown = JSON.parse(payload);
  return parsed;
};

const readToolListResult = async (
  response: Response
): Promise<z.infer<typeof toolListMessageSchema>["result"]> =>
  toolListMessageSchema.parse(await readMcpPayload(response)).result;

const readToolCallResult = async (
  response: Response
): Promise<z.infer<typeof toolCallMessageSchema>["result"]> =>
  toolCallMessageSchema.parse(await readMcpPayload(response)).result;

describe("transactional mail MCP tools", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("advertises the send_email tool with its input schema", async () => {
    const handler = createTestHandler(
      vi.fn<SendTransactionalMail>().mockResolvedValue({
        messageId: "ses-1",
        sent: true,
      })
    );
    const response = await postMcp(handler, {
      id: 1,
      jsonrpc: "2.0",
      method: "tools/list",
      params: {},
    });

    expect(response.status).toBe(200);
    const { tools } = await readToolListResult(response);
    const sendTool = tools.find((tool) => tool.name === "send_email");

    expect(sendTool).toBeDefined();
    expect(sendTool?.inputSchema).toBeDefined();
    expect(JSON.stringify(sendTool?.inputSchema)).toContain("idempotencyKey");
  });

  test("sends a message and returns the delivery identifier", async () => {
    const sendTransactionalMail = vi
      .fn<SendTransactionalMail>()
      .mockResolvedValue({ messageId: "ses-123", sent: true });
    const handler = createTestHandler(sendTransactionalMail);

    const response = await postMcp(handler, {
      id: 2,
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        arguments: {
          from: "Acme <hello@acme.com>",
          idempotencyKey: "order-42",
          subject: "Your receipt",
          text: "Thanks for your order.",
          to: ["customer@example.com"],
        },
        name: "send_email",
      },
    });

    expect(response.status).toBe(200);
    const result = await readToolCallResult(response);
    expect(result.isError).not.toBeTruthy();
    expect(result.structuredContent).toStrictEqual({
      idempotent: false,
      messageId: "ses-123",
      sent: true,
    });
    expect(result.content[0]?.text).toContain("ses-123");
    const [call] = sendTransactionalMail.mock.calls[0] ?? [];
    expect(call?.organizationId).toBe("team-a");
    expect(call?.message).toMatchObject({
      from: "Acme <hello@acme.com>",
      idempotencyKey: "order-42",
      subject: "Your receipt",
      text: "Thanks for your order.",
      to: ["customer@example.com"],
    });
  });

  test("marks replayed idempotent sends in the result", async () => {
    const handler = createTestHandler(
      vi.fn<SendTransactionalMail>().mockResolvedValue({
        idempotent: true,
        messageId: "ses-123",
        sent: true,
      })
    );

    const response = await postMcp(handler, {
      id: 3,
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        arguments: {
          from: "hello@acme.com",
          idempotencyKey: "order-42",
          subject: "Your receipt",
          text: "Thanks for your order.",
          to: ["customer@example.com"],
        },
        name: "send_email",
      },
    });
    const result = await readToolCallResult(response);

    expect(result.isError).not.toBeTruthy();
    expect(result.structuredContent?.idempotent).toBeTruthy();
    expect(result.content[0]?.text).toContain("already sent");
  });

  test("returns expected send rejections without reporting them", async () => {
    const rejection = Object.assign(
      new Error("Sender domain is not verified for this team."),
      { name: "OrganizationMailSendError", status: 403 }
    );
    const handler = createTestHandler(
      vi.fn<SendTransactionalMail>().mockRejectedValue(rejection)
    );

    const response = await postMcp(handler, {
      id: 4,
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        arguments: {
          from: "hello@acme.com",
          subject: "Your receipt",
          text: "Thanks for your order.",
          to: ["customer@example.com"],
        },
        name: "send_email",
      },
    });
    const result = await readToolCallResult(response);

    expect(result.isError).toBeTruthy();
    expect(result.content[0]?.text).toBe(
      "Sender domain is not verified for this team."
    );
    expect(mocks.reportServerError).not.toHaveBeenCalled();
  });

  test("reports unexpected send failures and hides the cause", async () => {
    const failure = new Error("Provider connection reset.");
    const handler = createTestHandler(
      vi.fn<SendTransactionalMail>().mockRejectedValue(failure)
    );

    const response = await postMcp(handler, {
      id: 5,
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        arguments: {
          from: "hello@acme.com",
          subject: "Your receipt",
          text: "Thanks for your order.",
          to: ["customer@example.com"],
        },
        name: "send_email",
      },
    });
    const result = await readToolCallResult(response);

    expect(result.isError).toBeTruthy();
    expect(result.content[0]?.text).toBe(
      "Could not send the mail message. Try again later."
    );
    expect(mocks.reportServerError).toHaveBeenCalledWith(
      failure,
      "transactional-mail-mcp-send"
    );
  });

  test("rejects message content the send service would refuse", async () => {
    const sendTransactionalMail = vi.fn<SendTransactionalMail>();
    const handler = createTestHandler(sendTransactionalMail);

    const response = await postMcp(handler, {
      id: 6,
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        arguments: {
          from: "not-an-email",
          subject: "Your receipt",
          text: "Thanks for your order.",
          to: ["customer@example.com"],
        },
        name: "send_email",
      },
    });
    const result = await readToolCallResult(response);

    expect(result.isError).toBeTruthy();
    expect(result.content[0]?.text).toContain("not valid");
    expect(sendTransactionalMail).not.toHaveBeenCalled();
  });
});

describe("transactional mail MCP endpoint", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("answers CORS preflight without credentials", async () => {
    const response = await handleTransactionalMailMcpRequest(
      new Request("https://quieter.email/api/v1/mcp", { method: "OPTIONS" })
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(
      response.headers.get("access-control-allow-headers") ?? ""
    ).toContain("authorization");
  });

  test("rejects requests without a team API key", async () => {
    mocks.resolveOrganizationId.mockResolvedValue(null);
    const response = await handleTransactionalMailMcpRequest(
      mcpRequest({ id: 1, jsonrpc: "2.0", method: "tools/list", params: {} })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
  });

  test("rejects payloads above the send limit", async () => {
    mocks.resolveOrganizationId.mockResolvedValue("team-a");
    const response = await handleTransactionalMailMcpRequest(
      new Request("https://quieter.email/api/v1/mcp", {
        body: "{}",
        headers: {
          "content-length": String(26 * 1024 * 1024),
          "content-type": "application/json",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(413);
  });

  test("answers discovery for an authenticated team", async () => {
    mocks.resolveOrganizationId.mockResolvedValue("team-a");
    const response = await handleTransactionalMailMcpRequest(
      mcpRequest({ id: 1, jsonrpc: "2.0", method: "tools/list", params: {} })
    );

    expect(response.status).toBe(200);
    const { tools } = await readToolListResult(response);
    expect(tools.map((tool) => tool.name)).toContain("send_email");
    expect(mocks.resolveOrganizationId).toHaveBeenCalledWith(
      expect.any(Request)
    );
  });
});
