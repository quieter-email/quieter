import { parseItem, serializeItem } from "structured-headers";
import { z } from "zod";

const originSchema = z.string().refine((value) => {
  if (!/^[\u0020-\u007E]+$/u.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    if (url.origin === "null" || url.origin !== value) {
      return false;
    }
    const host = url.hostname.replace(/\.$/u, "");
    return (
      url.protocol === "https:" ||
      url.protocol === "wss:" ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      /^127\.(?:\d{1,3}\.){2}\d{1,3}$/u.test(host) ||
      host === "[::1]"
    );
  } catch {
    return false;
  }
}, "OTP origin must be a canonical, potentially trustworthy origin.");

export const otpTokenSchema = z.object({
  code: z
    .string()
    .regex(/^[\u0020-\u007E]+$/u, "OTP code must be nonempty printable ASCII."),
  origin: originSchema,
});

export type OtpToken = z.infer<typeof otpTokenSchema>;

export const serializeOtpToken = (token: OtpToken): string =>
  serializeItem(token.code, new Map([["origin", token.origin]]));

export const parseOtpTokenHeaders = (
  headers: readonly { name: string; value: string }[]
): OtpToken | null => {
  const fields = headers.filter(
    ({ name }) => name.toLowerCase() === "otp-token"
  );
  if (fields.length !== 1 || fields[0] === undefined) {
    return null;
  }
  const value = fields[0].value.replaceAll(/\r\n(?=[\t ])/gu, "");
  if (/[\r\n]/u.test(value)) {
    return null;
  }
  try {
    const [code, parameters] = parseItem(value);
    const result = otpTokenSchema.safeParse({
      code,
      origin: parameters.get("origin"),
    });
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};
