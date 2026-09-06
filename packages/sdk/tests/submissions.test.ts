import { describe, expect, it, vi } from "vite-plus/test";

import { Quieter, QuieterApiError } from "../src/index.ts";
import type { QuieterFetch } from "../src/index.ts";

const messageId = "6d749f00-5b38-47de-a4fc-2f1dd2a309d0";
const input = {
  from: "sender@example.com",
  subject: "Fixture",
  text: "Fixture",
  to: ["reader@example.com"],
};
describe("durable submissions", () => {
  it("reuses the caller's key and request after losing an acceptance response", async () => {
    const fetch = vi
      .fn<QuieterFetch>()
      .mockRejectedValueOnce(new Error("Response lost"))
      .mockResolvedValueOnce(Response.json({ messageId, status: "queued" }));
    const client = new Quieter({
      apiKey: "fixture",
      baseUrl: "https://mail.example.com",
      fetch,
    });
    const options = { idempotencyKey: crypto.randomUUID() };
    await expect(client.submit(input, options)).rejects.toThrow(
      "Response lost"
    );
    await expect(client.submit(input, options)).resolves.toStrictEqual({
      messageId,
      status: "queued",
    });
    expect(fetch.mock.calls[0]).toStrictEqual(fetch.mock.calls[1]);
    expect(fetch.mock.calls[1][1]).toMatchObject({
      headers: { "idempotency-key": options.idempotencyKey },
      method: "POST",
    });
    expect(fetch.mock.calls[1][0]).toStrictEqual(
      new URL("https://mail.example.com/api/v2/send")
    );
  });

  it("rejects mismatched or invalid keys before making a request", async () => {
    const fetch = vi.fn<QuieterFetch>();
    const client = new Quieter({ apiKey: "fixture", fetch });
    await expect(client.submit(input, { idempotencyKey: "" })).rejects.toThrow(
      "valid idempotencyKey"
    );
    await expect(
      client.submit(
        { ...input, idempotencyKey: "one" },
        { idempotencyKey: "two" }
      )
    ).rejects.toThrow("must match");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never interprets synchronous sent responses as queue acceptance", async () => {
    const fetch = vi
      .fn<QuieterFetch>()
      .mockResolvedValue(Response.json({ messageId, sent: true }));
    const client = new Quieter({ apiKey: "fixture", fetch });
    await expect(
      client.submit(input, { idempotencyKey: "fixture" })
    ).rejects.toThrow("unexpected acceptance");
  });

  it("preserves overload errors without starting hidden retries", async () => {
    const fetch = vi
      .fn<QuieterFetch>()
      .mockResolvedValue(
        Response.json({ error: "At capacity" }, { status: 503 })
      );
    const client = new Quieter({ apiKey: "fixture", fetch });
    await expect(
      client.submit(input, { idempotencyKey: "fixture" })
    ).rejects.toMatchObject({ message: "At capacity", status: 503 });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("reads processing status separately and rejects delivery-shaped responses", async () => {
    const result = {
      acceptedAt: new Date().toISOString(),
      completedAt: null,
      messageId,
      status: "pending_confirmation",
      updatedAt: new Date().toISOString(),
    };
    const fetch = vi
      .fn<QuieterFetch>()
      .mockResolvedValueOnce(Response.json(result))
      .mockResolvedValueOnce(
        Response.json({ events: [], messageId, recipients: [] })
      );
    const client = new Quieter({ apiKey: "fixture", fetch });
    await expect(client.getSubmission(messageId)).resolves.toStrictEqual(
      result
    );
    expect(fetch.mock.calls[0][0]).toStrictEqual(
      new URL(`https://quieter.email/api/v2/messages/${messageId}`)
    );
    await expect(client.getSubmission(messageId)).rejects.toBeInstanceOf(
      QuieterApiError
    );
  });
});
