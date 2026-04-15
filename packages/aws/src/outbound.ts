import { sendManagedMail } from "@quietr/orpc/mail-aws-service";
import { z } from "zod";
import {
  getBearerToken,
  parseEventJson,
  readConfiguredEnv,
  toJson,
  type LambdaFunctionUrlEvent,
  type LambdaFunctionUrlResponse,
} from "./function-url";

const outboundPayloadSchema = z
  .object({
    bcc: z.array(z.string().trim().email()).optional(),
    cc: z.array(z.string().trim().email()).optional(),
    from: z.string().trim().email(),
    html: z.string().min(1).optional(),
    replyTo: z.array(z.string().trim().email()).optional(),
    subject: z.string().trim().min(1),
    text: z.string().min(1).optional(),
    to: z.array(z.string().trim().email()).min(1),
  })
  .refine((input) => Boolean(input.html || input.text), {
    message: "Either text or html is required.",
    path: ["text"],
  });

const normalizeAddresses = (addresses: string[] | undefined) =>
  Array.from(
    new Set((addresses ?? []).map((address) => address.trim().toLowerCase()).filter(Boolean)),
  );

const getOutboundToken = () => {
  const token = readConfiguredEnv("MAIL_SEND_TOKEN", "EMAIL_SEND_TOKEN", "MANAGED_MAIL_SEND_TOKEN");

  if (!token) {
    throw new Error("MAIL_SEND_TOKEN environment variable is missing.");
  }

  return token;
};

export const handler = async (
  event: LambdaFunctionUrlEvent,
): Promise<LambdaFunctionUrlResponse> => {
  try {
    const method = event.requestContext?.http?.method?.toUpperCase();

    if (method !== "POST") {
      return toJson(
        {
          error: "Method not allowed",
        },
        405,
      );
    }

    const bearerToken = getBearerToken(event.headers);

    if (!bearerToken || bearerToken !== getOutboundToken()) {
      return toJson(
        {
          error: "Unauthorized",
        },
        401,
      );
    }

    const parsed = outboundPayloadSchema.safeParse(parseEventJson(event));

    if (!parsed.success) {
      return toJson(
        {
          error: "Invalid outbound payload",
          issues: parsed.error.issues,
        },
        400,
      );
    }

    const response = await sendManagedMail({
      bcc: normalizeAddresses(parsed.data.bcc),
      cc: normalizeAddresses(parsed.data.cc),
      from: parsed.data.from.trim().toLowerCase(),
      html: parsed.data.html,
      replyTo: normalizeAddresses(parsed.data.replyTo),
      subject: parsed.data.subject,
      text: parsed.data.text,
      to: normalizeAddresses(parsed.data.to),
    });

    return toJson(
      {
        ...response,
      },
      201,
    );
  } catch (error) {
    console.error(error);

    return toJson(
      {
        error: "Could not send the mail message.",
      },
      500,
    );
  }
};
