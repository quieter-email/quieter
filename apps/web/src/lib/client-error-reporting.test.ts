import { describe, expect, test } from "vite-plus/test";

import {
  isExpectedClientError,
  shouldDiscardClientError,
} from "./client-error-reporting";

describe("client error reporting", () => {
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
