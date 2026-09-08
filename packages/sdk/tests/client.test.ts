/* oxlint-disable require-await -- Fetch fixtures retain the async contract without external I/O. */
import { jsx } from "react/jsx-runtime";
import { describe, expect, test } from "vite-plus/test";

import { Quieter, QuieterApiError } from "../src";
import { Quieter as ReactQuieter } from "../src/react";

describe(Quieter, () => {
  test("rejects malformed successful responses, including nested records", async () => {
    const client = new Quieter({
      apiKey: "quieter_test",
      fetch: async (input) => {
        const path = new Request(input).url;
        if (path.endsWith("send")) {
          return Response.json({ sent: true });
        }
        if (path.includes("messages")) {
          return Response.json({
            events: [],
            messageId: "one",
            recipients: [{ status: "delivered" }],
          });
        }
        return Response.json({ data: [{ recipient: "to@example.com" }] });
      },
    });
    await expect(
      client.send({
        from: "from@example.com",
        subject: "Hello",
        text: "Hello",
        to: "to@example.com",
      })
    ).rejects.toBeInstanceOf(QuieterApiError);
    await expect(client.getMessage("one")).rejects.toBeInstanceOf(
      QuieterApiError
    );
    await expect(client.listSuppressions()).rejects.toBeInstanceOf(
      QuieterApiError
    );
  });

  test("preserves attachment bytes and forwards tracking and idempotency options", async () => {
    let sent: Request | undefined;
    const client = new Quieter({
      apiKey: "quieter_test",
      fetch: async (input, init) => {
        sent = new Request(input, init);
        return Response.json({ messageId: "one", sent: true });
      },
    });
    await client.send(
      {
        attachments: [
          { content: "AP8=", filename: "encoded" },
          { content: "café", contentEncoding: "raw", filename: "text" },
          {
            content: new Uint8Array([42, 0, 255, 42]).subarray(1, 3),
            filename: "view",
          },
          { content: new Uint8Array([0, 255]).buffer, filename: "buffer" },
          { content: new Blob([new Uint8Array([0, 255])]), filename: "blob" },
        ],
        from: "from@example.com",
        openTracking: false,
        subject: "Hello",
        text: "Hello",
        to: "to@example.com",
      },
      { idempotencyKey: "send-once" }
    );
    expect(sent?.headers.get("idempotency-key")).toBe("send-once");
    await expect(sent?.json()).resolves.toMatchObject({
      attachments: [
        { content: "AP8=", filename: "encoded" },
        { content: "Y2Fmw6k=", filename: "text" },
        { content: "AP8=", filename: "view" },
        { content: "AP8=", filename: "buffer" },
        { content: "AP8=", filename: "blob" },
      ],
      openTracking: false,
    });
  });

  test("sends provider-style payloads to /api/v1/send", async () => {
    const calls: Request[] = [];
    const client = new Quieter({
      apiKey: "quieter_test",
      baseUrl: "https://example.com",
      fetch: async (input, init) => {
        calls.push(new Request(input, init));
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
    expect(calls[0]?.url).toBe("https://example.com/api/v1/send");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer quieter_test");
    await expect(calls[0]?.json()).resolves.toMatchObject({
      from: "Demo <demo@example.com>",
      html: "<strong>It works</strong>",
    });
  });

  test("renders react input before sending", async () => {
    let body: unknown;
    const client = new ReactQuieter({
      apiKey: "quieter_test",
      fetch: async (_input, init) => {
        body = await new Request(_input, init).json();
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
      text: "Welcome",
    });
    expect(body).toHaveProperty("html", expect.stringContaining("Welcome"));
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

  test("loads recipient-level delivery state", async () => {
    let requestedUrl = "";
    const client = new Quieter({
      apiKey: "quieter_test",
      baseUrl: "https://example.com",
      fetch: async (input) => {
        requestedUrl = new Request(input).url;
        return await Promise.resolve(
          Response.json({
            events: [],
            messageId: "message/1",
            recipients: [
              {
                lastEventAt: "2026-08-14T10:00:00.000Z",
                recipient: "to@example.com",
                status: "delivered",
              },
            ],
          })
        );
      },
    });

    const delivery = await client.getMessage("message/1");

    expect(requestedUrl).toBe(
      "https://example.com/api/v1/messages/message%2F1"
    );
    expect(delivery.recipients[0]?.status).toBe("delivered");
  });

  test("lists recipient suppressions", async () => {
    let requestedUrl = "";
    const client = new Quieter({
      apiKey: "quieter_test",
      baseUrl: "https://example.com",
      fetch: async (input) => {
        requestedUrl = new Request(input).url;
        return await Promise.resolve(
          Response.json({
            data: [
              {
                createdAt: "2026-08-14T10:00:00.000Z",
                reason: "complaint",
                recipient: "to@example.com",
                sourceProviderMessageId: "message-1",
              },
            ],
          })
        );
      },
    });

    const suppressions = await client.listSuppressions({ limit: 25 });

    expect(requestedUrl).toBe(
      "https://example.com/api/v1/suppressions?limit=25"
    );
    expect(suppressions[0]?.reason).toBe("complaint");
  });
});
