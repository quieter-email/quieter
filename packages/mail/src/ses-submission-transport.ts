import {
  SESv2Client,
  SESv2ServiceException,
  SendEmailCommand,
} from "@aws-sdk/client-sesv2";
import type { SESv2ClientConfig } from "@aws-sdk/client-sesv2";
import { z } from "zod";

import type {
  PreparedSubmission,
  SubmissionTransportResult,
} from "./submission-transport.ts";

const correlationSchema = z.strictObject({
  attemptId: z.uuid(),
  submissionId: z.uuid(),
});
const rejectedRequests = new Set([
  "AccountSuspendedException",
  "BadRequestException",
  "LimitExceededException",
  "MailFromDomainNotVerifiedException",
  "MessageRejected",
  "NotFoundException",
  "SendingPausedException",
]);

export class SesSubmissionTransport {
  private readonly client: SESv2Client;
  private readonly configurationSetName: string;

  constructor(input: {
    region: string;
    configurationSetName: string;
    credentials?: SESv2ClientConfig["credentials"];
    requestHandler?: SESv2ClientConfig["requestHandler"];
  }) {
    if (
      !/^[a-z]{2}(?:-[a-z]+)+-\d$/u.test(input.region) ||
      !/^[\w-]{1,64}$/u.test(input.configurationSetName)
    ) {
      throw new Error(
        "Submission transport requires an explicit region and feedback configuration set."
      );
    }
    this.configurationSetName = input.configurationSetName;
    this.client = new SESv2Client({
      credentials: input.credentials,
      maxAttempts: 1,
      region: input.region,
      requestHandler: input.requestHandler ?? {
        connectionTimeout: 5000,
        requestTimeout: 10_000,
        throwOnRequestTimeout: true,
      },
    });
  }

  async send(input: PreparedSubmission): Promise<SubmissionTransportResult> {
    const correlation = correlationSchema.safeParse({
      attemptId: input.attemptId,
      submissionId: input.submissionId,
    });
    if (
      !correlation.success ||
      input.tags.some((tag) => tag.name.toLowerCase().startsWith("quieter_"))
    ) {
      return {
        code: "invalid_correlation",
        outcome: "rejected",
        retryable: false,
      };
    }
    const remaining = input.deadline.getTime() - Date.now();
    if (!Number.isFinite(remaining) || remaining < 1000) {
      return {
        code: "attempt_deadline_elapsed",
        outcome: "rejected",
        retryable: true,
      };
    }
    try {
      const response = await this.client.send(
        new SendEmailCommand({
          ConfigurationSetName: this.configurationSetName,
          Content: { Raw: { Data: new TextEncoder().encode(input.raw) } },
          Destination: {
            BccAddresses: input.bcc,
            CcAddresses: input.cc,
            ToAddresses: input.to,
          },
          EmailTags: [
            ...input.tags.map((tag) => ({ Name: tag.name, Value: tag.value })),
            { Name: "quieter_submission", Value: input.submissionId },
            { Name: "quieter_attempt", Value: input.attemptId },
          ],
          FromEmailAddress: input.from,
          ReplyToAddresses: input.replyTo,
        }),
        { abortSignal: AbortSignal.timeout(Math.min(10_000, remaining)) }
      );
      if (
        response.MessageId === undefined ||
        !/^[\w-]{1,256}$/u.test(response.MessageId)
      ) {
        return { code: "provider_confirmation_missing", outcome: "unknown" };
      }
      return { outcome: "accepted", providerMessageId: response.MessageId };
    } catch (error) {
      if (error instanceof SESv2ServiceException) {
        if (
          error.name === "TooManyRequestsException" &&
          error.$metadata.httpStatusCode === 429
        ) {
          return {
            code: "provider_throttled",
            outcome: "rejected",
            retryable: true,
          };
        }
        if (
          rejectedRequests.has(error.name) &&
          [400, 404].includes(error.$metadata.httpStatusCode ?? 0)
        ) {
          return {
            code: "provider_rejected",
            outcome: "rejected",
            retryable: false,
          };
        }
      }
      return { code: "provider_outcome_unknown", outcome: "unknown" };
    }
  }

  close(): void {
    this.client.destroy();
  }
}
