import { jsx } from "react/jsx-runtime";
import { describe, expect, test, vi } from "vite-plus/test";

import { Quieter, QuieterApiError } from "../src";

vi.mock(import("@react-email/render"), () => ({
  render: async () => await Promise.resolve("<strong>Rendered html</strong>"),
}));

const getRequestBody = (body: BodyInit | null | undefined) =>
  typeof body === "string" ? body : "";

const getRequestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
};

describe(Quieter, () => {
  test("sends provider-style payloads to /api/v1/send", async () => {
    const calls: { init?: RequestInit; input: RequestInfo | URL }[] = [];
    const client = new Quieter({
      apiKey: "quieter_test",
      baseUrl: "https://example.com",
      fetch: async (input, init) => {
        calls.push({ init, input });
        return await Promise.resolve(
          Response.json({ messageId: "message-1", sent: true }, { status: 201 })
        );
      },
    });

    const result = await client.send({
      from: "Demo <demo@example.com>",
      html: "<strong>It works</strong>",
      subject: "Hello",
      text: "It works",
      to: ["to@example.com"],
    });

    expect(result).toStrictEqual({ messageId: "message-1", sent: true });
    expect(getRequestUrl(calls[0].input)).toBe(
      "https://example.com/api/v1/send"
    );
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(
      "Bearer quieter_test"
    );
    expect(JSON.parse(getRequestBody(calls[0]?.init?.body))).toMatchObject({
      from: "Demo <demo@example.com>",
      html: "<strong>It works</strong>",
    });
  });

  test("renders react input before sending", async () => {
    let body: unknown;
    const client = new Quieter({
      apiKey: "quieter_test",
      fetch: async (_input, init) => {
        body = JSON.parse(getRequestBody(init?.body));
        return await Promise.resolve(
          Response.json({ messageId: "message-1", sent: true }, { status: 201 })
        );
      },
    });

    await client.send({
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
      fetch: async () =>
        await Promise.resolve(
          Response.json({ error: "Nope" }, { status: 403 })
        ),
    });

    await expect(
      client.send({
        from: "demo@example.com",
        subject: "Hello",
        text: "Hello",
        to: "to@example.com",
      })
    ).rejects.toBeInstanceOf(QuieterApiError);
  });
});
