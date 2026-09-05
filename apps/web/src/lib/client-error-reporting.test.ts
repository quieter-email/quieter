import { describe, expect, test } from "vite-plus/test";

import {
  isExpectedClientError,
  shouldDiscardClientError,
} from "./client-error-reporting";

describe("client error reporting", () => {
  test.each([
    "Failed to fetch dynamically imported module: https://quieter.email/assets/settings-old.js",
    "error loading dynamically imported module: https://quieter.email/assets/settings-old.js",
    "Importing a module script failed.",
    "Unable to preload CSS for /assets/settings-old.css",
  ])("discards asset load failures: %s", (message) => {
    expect(shouldDiscardClientError({}, new TypeError(message))).toBeTruthy();
    expect(
      shouldDiscardClientError(
        {},
        new Error("Route failed", {
          cause: new TypeError(message),
        })
      )
    ).toBeTruthy();
    expect(shouldDiscardClientError({ message }, null)).toBeTruthy();
    expect(
      shouldDiscardClientError(
        { exception: { values: [{ value: message }] } },
        null
      )
    ).toBeTruthy();
  });

  test.each([
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "Cannot read properties of undefined (reading 'default')",
    "Unexpected token '<'",
    "Could not check billing access. Please try again.",
  ])("keeps unrelated failures: %s", (message) => {
    expect(shouldDiscardClientError({}, new Error(message))).toBeFalsy();
    expect(
      shouldDiscardClientError(
        { exception: { values: [{ value: message }] } },
        null
      )
    ).toBeFalsy();
  });

  test("keeps cyclic unknown errors without looping", () => {
    const error = new Error("Unknown failure");
    error.cause = error;
    expect(shouldDiscardClientError({}, error)).toBeFalsy();
  });

  test("recognizes structured mailbox reauthorization errors", () => {
    expect(
      isExpectedClientError({
        code: "MAILBOX_SCOPE_REPAIR_REQUIRED",
        message: "A transport-specific message.",
      })
    ).toBeTruthy();
  });

  test("recognizes wrapped mailbox reauthorization errors", () => {
    expect(
      isExpectedClientError({
        cause: new Error(
          "Google access needs to be reconnected for this mailbox."
        ),
      })
    ).toBeTruthy();
  });

  test("keeps unrelated errors", () => {
    expect(
      isExpectedClientError(new Error("The realtime connection failed."))
    ).toBeFalsy();
  });

  test("handles cyclic error causes", () => {
    const error: { cause?: unknown; message: string } = {
      message: "Unexpected failure.",
    };
    error.cause = error;
    expect(isExpectedClientError(error)).toBeFalsy();
  });

  test("discards serialized mailbox reauthorization events", () => {
    expect(
      shouldDiscardClientError(
        {
          exception: {
            values: [
              {
                value:
                  "Google access needs to be reconnected for this mailbox.",
              },
            ],
          },
        },
        null
      )
    ).toBeTruthy();
  });
});
