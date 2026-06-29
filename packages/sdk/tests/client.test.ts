import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { jsx } from "react/jsx-runtime";
import { Quieter, QuieterApiError } from "../src";
import { quieter } from "../src/email-sdk";
import { sendReactEmail } from "../src/react-email";

describe("Quieter", () => {
  beforeEach(() => {
    mock.module("@react-email/render", () => ({
      render: async () => "<strong>Rendered html</strong>",
    }));
  });

  afterEach(() => {
    mock.restore();
  });

  test("sends provider-style payloads to /api/v1/send", async () => {
    const calls: Array<{ init?: RequestInit; input: RequestInfo | URL }> = [];
    const client = new Quieter({
      apiKey: "quieter_test",
      baseUrl: "https://example.com",
      fetch: async (input, init) => {
        calls.push({ init, input });
        return Response.json({ messageId: "message-1", sent: true }, { status: 201 });
      },
    });

    const result = await client.send({
      from: "Demo <demo@example.com>",
      html: "<strong>It works</strong>",
      subject: "Hello",
      text: "It works",
      to: ["to@example.com"],
    });

    expect(result).toEqual({ messageId: "message-1", sent: true });
    expect(String(calls[0]?.input)).toBe("https://example.com/api/v1/send");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer quieter_test");
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      from: "Demo <demo@example.com>",
      html: "<strong>It works</strong>",
    });
  });

  test("renders react input before sending", async () => {
    let body: unknown;
    const client = new Quieter({
      apiKey: "quieter_test",
      fetch: async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({ messageId: "message-1", sent: true }, { status: 201 });
      },
    });

    await sendReactEmail(client, {
      from: "demo@example.com",
      react: jsx("div", { children: "Welcome" }),
      subject: "Hello",
      text: "Welcome",
      to: "to@example.com",
    });

    expect(body).toMatchObject({
      html: "<strong>Rendered html</strong>",
      text: "Welcome",
    });
    expect(body).not.toHaveProperty("react");
  });

  test("throws QuieterApiError for API errors", async () => {
    const client = new Quieter({
      apiKey: "quieter_test",
      fetch: async () => Response.json({ error: "Nope" }, { status: 403 }),
    });

    await expect(
      client.send({
        from: "demo@example.com",
        subject: "Hello",
        text: "Hello",
        to: "to@example.com",
      }),
    ).rejects.toBeInstanceOf(QuieterApiError);
  });
});

describe("email-sdk adapter", () => {
  test("maps Email SDK messages to Quieter sends", async () => {
    let body: unknown;
    const provider = quieter({
      apiKey: "quieter_test",
      fetch: async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({ messageId: "message-1", sent: true }, { status: 201 });
      },
    });

    const result = await provider.send(
      {
        attachments: [
          {
            content: new TextEncoder().encode("hello"),
            filename: "hello.txt",
          },
        ],
        from: { email: "demo@example.com", name: "Demo" },
        html: "<strong>Hello</strong>",
        subject: "Hello",
        text: "Hello",
        to: "to@example.com",
      },
      { attempt: 1, idempotencyKey: "idem-1" },
    );

    expect(result).toMatchObject({
      messageId: "message-1",
      provider: "quieter",
    });
    expect(body).toMatchObject({
      from: "Demo <demo@example.com>",
      idempotencyKey: "idem-1",
    });
  });
});
