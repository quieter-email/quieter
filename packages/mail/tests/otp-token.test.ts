import { describe, expect, it } from "vite-plus/test";

import { parseOtpTokenHeaders, serializeOtpToken } from "../src/otp-token";
import { parseRawMailMessage } from "../src/raw-message";
import { sendMessageInputSchema } from "../src/send";
import { buildSendMimeMessage } from "../src/send-mime";

const origin = "https://example.com";
const input = {
  from: "a@example.com",
  subject: "Code",
  text: "Sign in",
  to: "b@example.com",
};

describe("OTP-Token", () => {
  it.each(['12"34\\56', "  12 34  ", `${"12  ".repeat(70)}end`])(
    "preserves code through real MIME %s",
    async (code) => {
      const message = sendMessageInputSchema.parse({
        ...input,
        otpToken: { code, origin },
      });
      const mime = await buildSendMimeMessage(message);
      const parsed = await parseRawMailMessage(mime.raw);
      expect(parseOtpTokenHeaders(parsed.headers)).toStrictEqual({
        code,
        origin,
      });
      expect(
        Math.max(...mime.raw.split("\r\n").map((line) => line.length))
      ).toBeLessThanOrEqual(998);
    }
  );

  it("accepts extensions and folding but discards extension data", () => {
    expect(
      parseOtpTokenHeaders([
        {
          name: "oTp-ToKeN",
          value: '"123";\r\n origin="https://example.com"; bearer="private"',
        },
      ])
    ).toStrictEqual({ code: "123", origin });
  });

  it.each([
    '""; origin="https://example.com"',
    '123; origin="https://example.com"',
    '"123"',
    '"123"; origin="http://example.com"',
    '"123"; origin="https://example.com/"',
    '"123"; origin="https://user@example.com"',
    '"123"; origin="http://localhost.example.com"',
    '"123"; origin="http://127.0.0.1.example.com"',
    '"123"; origin="http://127.1"',
    '"123"; origin="file://example.com"',
    '"123"; origin="https://example.com?x=1"',
    '"123"; origin="https://example.com#x"',
    '"123"; origin="https://example.com"; bad=(',
    '"123"; origin="https://example.com", "456"',
    '"123"; origin=?1',
    '"123"; origin="https://EXAMPLE.com"',
    '"123"; origin="https://example.com:443"',
    '"123"; origin="https://example.com"\r\nX: bad',
  ])("rejects unusable input %s", (value) => {
    expect(parseOtpTokenHeaders([{ name: "OTP-Token", value }])).toBeNull();
  });

  it.each([
    "https://example.com",
    "wss://example.com",
    "http://localhost",
    // oxlint-disable-next-line sonarjs/no-clear-text-protocols -- Canonical loopback origins are trustworthy.
    "http://sub.localhost.",
    "http://127.1.2.3",
    "http://[::1]",
    "ftp://127.0.0.1",
  ])("accepts trustworthy canonical origins %s", (trustedOrigin) => {
    expect(
      parseOtpTokenHeaders([
        {
          name: "OTP-Token",
          value: serializeOtpToken({ code: "123", origin: trustedOrigin }),
        },
      ])?.origin
    ).toBe(trustedOrigin);
  });

  it("rejects duplicate headers and typed/custom conflicts at the send boundary", () => {
    const header = {
      name: "OTP-Token",
      value: serializeOtpToken({ code: "123", origin }),
    };
    expect(parseOtpTokenHeaders([header, header])).toBeNull();
    expect(
      sendMessageInputSchema.safeParse({
        ...input,
        headers: [header, { ...header, name: "otp-token" }],
      }).success
    ).toBeFalsy();
    expect(
      sendMessageInputSchema.safeParse({
        ...input,
        headers: [header],
        otpToken: { code: "123", origin },
      }).success
    ).toBeFalsy();
    for (const code of ["123\r\nInjected: x", "é", "x".repeat(1100), ""]) {
      expect(
        sendMessageInputSchema.safeParse({
          ...input,
          otpToken: { code, origin },
        }).success
      ).toBeFalsy();
    }
  });

  it("preserves custom extensions through MIME and ignores nested fields", async () => {
    const value = '"123"; origin="https://example.com"; future=?1';
    const mime = await buildSendMimeMessage(
      sendMessageInputSchema.parse({
        ...input,
        headers: { "OTP-Token": value, "X-Custom": "ordinary" },
      })
    );
    const parsed = await parseRawMailMessage(mime.raw);
    expect(
      parsed.headers.find(({ name }) => name.toLowerCase() === "otp-token")
        ?.value
    ).toContain("future=?1");
    expect(
      parsed.headers.find(({ name }) => name.toLowerCase() === "x-custom")
        ?.value
    ).toBe("ordinary");
    const nested = await parseRawMailMessage(
      `From: a@example.com\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: text/plain\r\nOTP-Token: ${
        value
      }\r\n\r\nHello\r\n--x--`
    );
    expect(parseOtpTokenHeaders(nested.headers)).toBeNull();
  });
});
