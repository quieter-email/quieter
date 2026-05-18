import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { db, mailDomain } from "@quieter/database";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

export const TEAM_API_KEY_CONFIG_ID = "team";

export const teamMailMessageSchema = z
  .object({
    bcc: z.array(z.email().trim()).optional(),
    cc: z.array(z.email().trim()).optional(),
    html: z.string().min(1).optional(),
    replyTo: z.array(z.email().trim()).optional(),
    sender: z.email().trim(),
    subject: z.string().trim().min(1),
    text: z.string().min(1).optional(),
    to: z.array(z.email().trim()).min(1),
  })
  .refine((input) => !!(input.html || input.text), {
    message: "Either text or html is required.",
    path: ["text"],
  });

export type TeamMailMessageInput = z.infer<typeof teamMailMessageSchema>;

export class TeamMailSendError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TeamMailSendError";
  }
}

const normalizeAddresses = (addresses: string[] | undefined) =>
  Array.from(
    new Set((addresses ?? []).map((address) => address.trim().toLowerCase()).filter(Boolean)),
  );

const getSenderDomain = (sender: string) => {
  const domain = sender.trim().toLowerCase().split("@").at(1);

  if (!domain) {
    throw new TeamMailSendError("Sender must be an email address.", 400);
  }

  return domain;
};

const getAwsRegion = () => {
  const region = process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim();

  if (!region) {
    throw new TeamMailSendError("AWS_REGION or AWS_DEFAULT_REGION is required to send mail.", 500);
  }

  return region;
};

let sesv2Client: SESv2Client | null = null;

const getSesv2Client = () => {
  sesv2Client ??= new SESv2Client({ region: getAwsRegion() });
  return sesv2Client;
};

export const assertTeamOwnsVerifiedSenderDomain = async (input: {
  organizationId: string;
  sender: string;
}) => {
  const domain = getSenderDomain(input.sender);
  const [ownedDomain] = await db
    .select({ id: mailDomain.id })
    .from(mailDomain)
    .where(
      and(
        eq(mailDomain.organizationId, input.organizationId),
        eq(mailDomain.domain, domain),
        eq(mailDomain.status, "verified"),
      ),
    )
    .limit(1);

  if (!ownedDomain) {
    throw new TeamMailSendError("Sender domain is not verified for this team.", 403);
  }

  return domain;
};

export const sendTeamMailMessage = async (input: {
  message: TeamMailMessageInput;
  organizationId: string;
}) => {
  await assertTeamOwnsVerifiedSenderDomain({
    organizationId: input.organizationId,
    sender: input.message.sender,
  });

  const response = await getSesv2Client().send(
    new SendEmailCommand({
      Content: {
        Simple: {
          Body: {
            ...(input.message.html
              ? {
                  Html: {
                    Charset: "UTF-8",
                    Data: input.message.html,
                  },
                }
              : {}),
            ...(input.message.text
              ? {
                  Text: {
                    Charset: "UTF-8",
                    Data: input.message.text,
                  },
                }
              : {}),
          },
          Subject: {
            Charset: "UTF-8",
            Data: input.message.subject,
          },
        },
      },
      Destination: {
        BccAddresses: normalizeAddresses(input.message.bcc),
        CcAddresses: normalizeAddresses(input.message.cc),
        ToAddresses: normalizeAddresses(input.message.to),
      },
      FromEmailAddress: input.message.sender.trim().toLowerCase(),
      ReplyToAddresses: normalizeAddresses(input.message.replyTo),
    }),
  );

  return {
    messageId: response.MessageId ?? null,
    sent: true,
  };
};
