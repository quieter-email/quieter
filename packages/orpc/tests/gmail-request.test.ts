import { ORPCError } from "@orpc/server";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { runAuthorizedGmailMailbox } from "../src/gmail-mailbox-access";
import { callGmail } from "../src/gmail-request";

const authorization = vi.hoisted(() => ({
  afterOperation: vi.fn<() => Promise<void>>(),
  beforeOperation: vi.fn<() => Promise<void>>(),
}));

vi.mock(import("../src/gmail-mailbox-access"), () => ({
  runAuthorizedGmailMailbox: async <T>(
    _input: Parameters<typeof runAuthorizedGmailMailbox>[0],
    operation: (accessToken: string) => Promise<T>
  ) => {
    await authorization.beforeOperation();
    const result = await operation("fixture-token");
    await authorization.afterOperation();
    return result;
  },
}));

describe(callGmail, () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authorization.beforeOperation.mockResolvedValue();
    authorization.afterOperation.mockResolvedValue();
  });

  test("returns a retryable response without exposing the provider's error text", async () => {
    const headers = new Headers();
    const failure = Object.assign(
      new Error("Private provider quota details."),
      {
        retryAfterMs: 2500,
        status: 429,
      }
    );
    const result = await callGmail(
      { resHeaders: headers, userId: "fixture-user" },
      "fixture-mailbox",
      vi.fn<() => Promise<never>>().mockRejectedValue(failure)
    ).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(ORPCError);
    expect(result).toMatchObject({
      code: "RATE_LIMITED",
      data: { retryAfter: 3 },
      status: 429,
    });
    expect(headers.get("retry-after")).toBe("3");
    expect(String(result)).not.toContain(failure.message);
  });

  test("identifies a send that never started when authorization temporarily fails", async () => {
    const failure = new Error("Token refresh failed.");
    authorization.beforeOperation.mockRejectedValue(failure);
    const send = vi.fn<() => Promise<string>>();
    const result = await callGmail(
      { userId: "fixture-user" },
      "fixture-mailbox",
      send,
      { kind: "send" }
    ).catch((error: unknown) => error);

    expect(result).toMatchObject({
      cause: failure,
      code: "INTERNAL_SERVER_ERROR",
      data: { sendNotStarted: true },
      message: failure.message,
      status: 500,
    });
    expect(send).not.toHaveBeenCalled();
  });

  test("preserves a user-facing authorization failure when a send never started", async () => {
    const failure = new ORPCError("FORBIDDEN", {
      data: { reconnectRequired: true },
      message: "Reconnect your mailbox before sending.",
    });
    authorization.beforeOperation.mockRejectedValue(failure);
    const result = await callGmail(
      { userId: "fixture-user" },
      "fixture-mailbox",
      vi.fn<() => Promise<string>>(),
      { kind: "send" }
    ).catch((error: unknown) => error);

    expect(result).toMatchObject({
      cause: failure,
      code: failure.code,
      data: { reconnectRequired: true, sendNotStarted: true },
      message: failure.message,
      status: failure.status,
    });
  });

  test("keeps an ambiguous provider send failure unchanged", async () => {
    const failure = new ORPCError("INTERNAL_SERVER_ERROR", {
      data: { deliveryUncertain: true },
      message: "Delivery is being confirmed.",
    });
    const result = await callGmail(
      { userId: "fixture-user" },
      "fixture-mailbox",
      vi.fn<() => Promise<string>>().mockRejectedValue(failure),
      { kind: "send" }
    ).catch((error: unknown) => error);

    expect(result).toBe(failure);
  });

  test("does not prove non-submission when authorization fails after the send callback ran", async () => {
    const failure = new Error("A later token refresh failed.");
    authorization.afterOperation.mockRejectedValue(failure);
    const result = await callGmail(
      { userId: "fixture-user" },
      "fixture-mailbox",
      vi.fn<() => Promise<string>>().mockResolvedValue("provider-result"),
      { kind: "send" }
    ).catch((error: unknown) => error);

    expect(result).toBe(failure);
  });

  test("leaves non-send authorization failures unchanged", async () => {
    const failure = new Error("Token refresh failed.");
    authorization.beforeOperation.mockRejectedValue(failure);
    const result = await callGmail(
      { userId: "fixture-user" },
      "fixture-mailbox",
      vi.fn<() => Promise<string>>()
    ).catch((error: unknown) => error);

    expect(result).toBe(failure);
  });
});
