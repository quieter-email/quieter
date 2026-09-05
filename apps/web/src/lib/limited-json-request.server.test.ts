import { describe, expect, test, vi } from "vite-plus/test";

import {
  LimitedJsonRequestError,
  readLimitedJsonRequest,
} from "./limited-json-request.server";

describe("limited JSON requests", () => {
  test("decodes UTF-8 characters split across chunks at the byte limit", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ message: "é" }));
    const init = {
      body: new ReadableStream({
        start(controller) {
          for (const byte of bytes) {
            controller.enqueue(new Uint8Array([byte]));
          }
          controller.close();
        },
      }),
      duplex: "half",
      method: "POST",
    };
    const request = new Request("https://example.test/api/chat", init);

    await expect(
      readLimitedJsonRequest(request, bytes.length)
    ).resolves.toStrictEqual({ message: "é" });
  });

  test.each(["1", "invalid"])(
    "enforces actual bytes despite Content-Length %s",
    async (length) => {
      const cancel = vi.fn<() => void>();
      const init = {
        body: new ReadableStream({
          cancel,
          start(controller) {
            controller.enqueue(new Uint8Array(6));
            controller.enqueue(new Uint8Array(6));
          },
        }),
        duplex: "half",
        headers: { "content-length": length },
        method: "POST",
      };
      const request = new Request("https://example.test/api/chat", init);

      await expect(readLimitedJsonRequest(request, 10)).rejects.toMatchObject({
        status: 413,
      });
      expect(cancel).toHaveBeenCalledOnce();
      expect(request.body?.locked).toBeFalsy();
    }
  );

  test("rejects declared oversized bodies before reading", async () => {
    const request = new Request("https://example.test/api/chat", {
      body: "{}",
      headers: { "content-length": "1001" },
      method: "POST",
    });
    await expect(readLimitedJsonRequest(request, 1000)).rejects.toMatchObject({
      status: 413,
    });
    expect(request.bodyUsed).toBeFalsy();
  });

  test("rejects invalid UTF-8 and missing bodies", async () => {
    await expect(
      readLimitedJsonRequest(
        new Request("https://example.test/api/chat", {
          body: new Uint8Array([34, 0xc3, 34]),
          method: "POST",
        }),
        1000
      )
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      readLimitedJsonRequest(
        new Request("https://example.test/api/chat", {
          method: "POST",
        }),
        1000
      )
    ).rejects.toMatchObject({ status: 400 });
  });

  test("accepts a valid request without Content-Length", async () => {
    const request = new Request("https://example.test/api/chat", {
      body: JSON.stringify({ message: "hello" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(request.headers.has("content-length")).toBeFalsy();
    await expect(readLimitedJsonRequest(request, 1000)).resolves.toStrictEqual({
      message: "hello",
    });
  });

  test("rejects bodies whose bytes exceed the limit", async () => {
    const request = new Request("https://example.test/api/chat", {
      body: JSON.stringify({ message: "ééé" }),
      method: "POST",
    });

    await expect(readLimitedJsonRequest(request, 10)).rejects.toMatchObject({
      status: 413,
    });
  });

  test("rejects malformed JSON with a classified error", async () => {
    const request = new Request("https://example.test/api/chat", {
      body: "not-json",
      method: "POST",
    });

    await expect(readLimitedJsonRequest(request, 1000)).rejects.toBeInstanceOf(
      LimitedJsonRequestError
    );
    await expect(
      readLimitedJsonRequest(
        new Request("https://example.test/api/chat", {
          body: "not-json",
          method: "POST",
        }),
        1000
      )
    ).rejects.toMatchObject({ status: 400 });
  });
});
