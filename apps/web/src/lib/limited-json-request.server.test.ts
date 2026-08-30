import { describe, expect, test } from "vite-plus/test";

import {
  LimitedJsonRequestError,
  readLimitedJsonRequest,
} from "./limited-json-request.server";

describe("limited JSON requests", () => {
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
