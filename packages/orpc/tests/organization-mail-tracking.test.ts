import {
  appendOpenTrackingPixel,
  buildOpenTrackingToken,
  verifyOpenTrackingToken,
} from "@quieter/mail/tracking";
import { describe, expect, test } from "vite-plus/test";

import { resolveEffectiveOpenTracking } from "../src/organization-mail-delivery";

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

  test("appends the marker before the closing body tag once", () => {
    const html = "<html><body><p>Hi</p></body></html>";
    const tracked = appendOpenTrackingPixel(html, "https://q.example/o/t");
    expect(tracked.match(/https:\/\/q\.example\/o\/t/gu)?.length).toBe(1);
    expect(tracked.endsWith("</body></html>")).toBeTruthy();
  });

  test("falls back to appending when no body tag exists", () => {
    const tracked = appendOpenTrackingPixel(
      "<p>Hi</p>",
      "https://q.example/o/t"
    );
    expect(tracked.endsWith("<p>Hi</p>")).toBeFalsy();
    expect(tracked).toContain("<p>Hi</p>");
    expect(tracked).toContain("https://q.example/o/t");
  });
});

describe(resolveEffectiveOpenTracking, () => {
  test("stays off until the organization enables it", () => {
    expect(
      resolveEffectiveOpenTracking({
        allowPerSendOverride: true,
        openTrackingEnabled: false,
      })
    ).toBeFalsy();
    expect(
      resolveEffectiveOpenTracking(
        { allowPerSendOverride: true, openTrackingEnabled: false },
        true
      )
    ).toBeFalsy();
  });

  test("follows organization policy without an override", () => {
    expect(
      resolveEffectiveOpenTracking({
        allowPerSendOverride: false,
        openTrackingEnabled: true,
      })
    ).toBeTruthy();
  });

  test("ignores per-send values unless overrides are allowed", () => {
    expect(
      resolveEffectiveOpenTracking(
        { allowPerSendOverride: false, openTrackingEnabled: true },
        false
      )
    ).toBeTruthy();
    expect(
      resolveEffectiveOpenTracking(
        { allowPerSendOverride: true, openTrackingEnabled: true },
        false
      )
    ).toBeFalsy();
    expect(
      resolveEffectiveOpenTracking(
        { allowPerSendOverride: true, openTrackingEnabled: true },
        true
      )
    ).toBeTruthy();
  });
});
