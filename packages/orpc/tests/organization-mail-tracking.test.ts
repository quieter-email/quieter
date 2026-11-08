import {
  buildOpenTrackingToken,
  verifyOpenTrackingToken,
} from "@quieter/mail/tracking";
import { describe, expect, test } from "vite-plus/test";

const SECRET = "test-signing-secret";

describe("open tracking tokens", () => {
  test("round-trips a message header id", () => {
    const token = buildOpenTrackingToken({
      messageHeaderId: "<abc@quieter.email>",
      secret: SECRET,
    });
    expect(verifyOpenTrackingToken(token, SECRET)).toBe("<abc@quieter.email>");
  });

  test("rejects tampered payloads and wrong secrets", () => {
    const token = buildOpenTrackingToken({
      messageHeaderId: "<abc@quieter.email>",
      secret: SECRET,
    });
    const [payload, signature] = token.split(".");
    expect(payload).toBeTruthy();
    expect(signature).toBeTruthy();
    if (signature === undefined || payload === undefined) {
      return;
    }
    const tamperedPayload = `${payload.slice(0, -2)}xy`;
    expect(
      verifyOpenTrackingToken(`${tamperedPayload}.${signature}`, SECRET)
    ).toBeNull();
    expect(verifyOpenTrackingToken(token, "other-secret")).toBeNull();
  });

  test("rejects malformed tokens", () => {
    expect(verifyOpenTrackingToken("not-a-token", SECRET)).toBeNull();
    expect(verifyOpenTrackingToken("", SECRET)).toBeNull();
    expect(verifyOpenTrackingToken(`e30.${"é".repeat(43)}`, SECRET)).toBeNull();
    expect(
      verifyOpenTrackingToken(`${"a".repeat(2000)}.${"b".repeat(43)}`, SECRET)
    ).toBeNull();
  });
});
