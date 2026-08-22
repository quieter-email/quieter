import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

const TRACKING_TOKEN_VERSION = 1;

const trackingTokenPayloadSchema = z.object({
  h: z.string().trim().min(1).max(500),
  v: z.literal(TRACKING_TOKEN_VERSION),
});

const signTokenPayload = (encodedPayload: string, secret: string) =>
  createHmac("sha256", secret).update(encodedPayload).digest("base64url");

/**
 * Open-tracking markers carry only the Quieter message header id, signed so
 * that fabricated or tampered tokens are rejected before any lookup.
 */
export const buildOpenTrackingToken = (input: {
  messageHeaderId: string;
  secret: string;
}): string => {
  const encodedPayload = Buffer.from(
    JSON.stringify({
      h: input.messageHeaderId,
      v: TRACKING_TOKEN_VERSION,
    })
  ).toString("base64url");
  return `${encodedPayload}.${signTokenPayload(encodedPayload, input.secret)}`;
};

export const verifyOpenTrackingToken = (
  token: string,
  secret: string
): string | null => {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [encodedPayload, signature] = parts;
  if (encodedPayload === "" || signature === "") {
    return null;
  }
  const expectedSignature = signTokenPayload(encodedPayload, secret);
  if (
    expectedSignature.length !== signature.length ||
    !timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature))
  ) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString());
  } catch {
    return null;
  }
  const parsed = trackingTokenPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data.h : null;
};

export const appendOpenTrackingPixel = (html: string, url: string): string => {
  const pixel =
    `<img src="${url}" alt="" width="1" height="1" ` +
    `style="display:block;visibility:hidden;opacity:0;border:0" />`;
  if (/<\/body>/iu.test(html)) {
    return html.replace(/<\/body>/iu, `${pixel}</body>`);
  }
  return `${html}${pixel}`;
};
