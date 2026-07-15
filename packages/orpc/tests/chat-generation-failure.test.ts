import { describe, expect, test } from "vite-plus/test";
import { getChatRunFailureMessage } from "../src/chat/generation/failure";

describe("chat generation failures", () => {
  test.each([
    "SDKError: API error occurred: Status 401",
    'Body: {"error":"invalid_token"}',
    "Request failed: unauthorized",
  ])("reports authentication failures accurately: %s", (message) => {
    expect(getChatRunFailureMessage(new Error(message))).toBe(
      "Quieter could not authenticate with a required service. Please contact support.",
    );
  });

  test("keeps network failures distinct from authentication failures", () => {
    expect(getChatRunFailureMessage(new TypeError("fetch failed"))).toBe(
      "The response connection was interrupted. Retry it to continue.",
    );
  });
});
