import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { Resource } from "sst";
import { z } from "zod";
import {
  getBearerToken,
  parseEventJson,
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
  .refine((input) => !!(input.html || input.text), {
    message: "Either text or html is required.",
    path: ["text"],
  });

const normalizeAddresses = (addresses: string[] | undefined) =>
  Array.from(
    new Set((addresses ?? []).map((address) => address.trim().toLowerCase()).filter(Boolean)),
  );

let sesv2Client: SESv2Client | null = null;

const getSesv2Client = () => {
  sesv2Client ??= new SESv2Client({
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
  });

  return sesv2Client;
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

    if (!bearerToken || bearerToken !== Resource.MailSendToken.value) {
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

    const response = await getSesv2Client().send(
      new SendEmailCommand({
        Content: {
          Simple: {
            Body: {
              ...(parsed.data.html
                ? {
                    Html: {
                      Charset: "UTF-8",
                      Data: parsed.data.html,
                    },
                  }
                : {}),
              ...(parsed.data.text
                ? {
                    Text: {
                      Charset: "UTF-8",
                      Data: parsed.data.text,
                    },
                  }
                : {}),
            },
            Subject: {
              Charset: "UTF-8",
              Data: parsed.data.subject,
            },
          },
        },
        Destination: {
          BccAddresses: normalizeAddresses(parsed.data.bcc),
          CcAddresses: normalizeAddresses(parsed.data.cc),
          ToAddresses: normalizeAddresses(parsed.data.to),
        },
        FromEmailAddress: parsed.data.from.trim().toLowerCase(),
        ReplyToAddresses: normalizeAddresses(parsed.data.replyTo),
      }),
    );

    return toJson(
      {
        messageId: response.MessageId ?? null,
        sent: true,
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
