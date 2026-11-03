import { ORPCError } from "@orpc/server";
import { describe, expect, test, vi } from "vite-plus/test";

import type { runAuthorizedGmailMailbox } from "../src/gmail-mailbox-access";
import { callGmail } from "../src/gmail-request";

vi.mock(import("../src/gmail-mailbox-access"), () => ({
  runAuthorizedGmailMailbox: async <T>(
    _input: Parameters<typeof runAuthorizedGmailMailbox>[0],
    operation: (accessToken: string) => Promise<T>
  ) => await operation("fixture-token"),
}));

describe(callGmail, () => {
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

  test("preserves unexpected errors for reporting", async () => {
    const failure = new Error("Unexpected mailbox failure.");
    await expect(
      callGmail(
        { userId: "fixture-user" },
        "fixture-mailbox",
        vi.fn<() => Promise<never>>().mockRejectedValue(failure)
      )
    ).rejects.toBe(failure);
  });
});
