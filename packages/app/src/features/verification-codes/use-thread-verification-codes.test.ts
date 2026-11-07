import { projectThreadVerificationCodes } from "@quieter/app/features/verification-codes/use-thread-verification-codes";
import type { VerificationCode } from "@quieter/app/features/verification-codes/use-thread-verification-codes";
import { describe, expect, test } from "vite-plus/test";

describe("verification code projection", () => {
  test("isolates colliding provider IDs", () => {
    const first: VerificationCode = {
      code: "111111",
      expiresAt: new Date(2000),
      messageId: "message",
      service: "First service",
      threadId: "same",
    };
    const second: VerificationCode = {
      code: "222222",
      expiresAt: new Date(3000),
      messageId: "message",
      service: "Second service",
      threadId: "same",
    };
    const buckets = [
      { uiIdByOriginalId: new Map([["same", "mailbox-a/same"]]) },
      { uiIdByOriginalId: new Map([["same", "mailbox-b/same"]]) },
    ];
    const results = [[first, { ...first, threadId: "unrequested" }], [second]];
    const codes = projectThreadVerificationCodes(buckets, results);
    expect(codes.get("mailbox-a/same")).toMatchObject({
      code: first.code,
    });
    expect(codes.get("mailbox-b/same")).toMatchObject({
      code: second.code,
    });
  });
});
