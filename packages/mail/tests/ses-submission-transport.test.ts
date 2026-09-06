import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { SesSubmissionTransport } from "../src/ses-submission-transport.ts";
import type { PreparedSubmission } from "../src/submission-transport.ts";

const prepared = (): PreparedSubmission => ({
  attemptId: randomUUID(),
  bcc: [],
  cc: [],
  deadline: new Date(Date.now() + 60_000),
  from: "sender@example.com",
  raw: "From: sender@example.com\r\nTo: recipient@example.com\r\nSubject: Fixture\r\n\r\nTest",
  replyTo: [],
  submissionId: randomUUID(),
  tags: [{ name: "campaign", value: "fixture" }],
  to: ["recipient@example.com"],
});
const responseSchema = z.object({
  ConfigurationSetName: z.string(),
  EmailTags: z.array(z.object({ Name: z.string(), Value: z.string() })),
});

describe("SES submission transport", () => {
  it.each([
    [429, "TooManyRequestsException", "rejected", "provider_throttled"],
    [400, "MessageRejected", "rejected", "provider_rejected"],
    [500, "InternalFailure", "unknown", "provider_outcome_unknown"],
    [503, "MessageRejected", "unknown", "provider_outcome_unknown"],
  ])(
    "makes one HTTP call for status %s and %s",
    async (statusCode, name, outcome, code) => {
      const handle = vi
        .fn<
          () => Promise<{
            response: {
              statusCode: number;
              headers: Record<string, string>;
              body: Uint8Array;
            };
          }>
        >()
        .mockResolvedValue({
          response: {
            body: new TextEncoder().encode(
              JSON.stringify({
                __type: name,
                message: "private recipient@example.com",
              })
            ),
            headers: {
              "content-type": "application/json",
              "x-amzn-errortype": name,
            },
            statusCode,
          },
        });
      const transport = new SesSubmissionTransport({
        configurationSetName: "proof",
        credentials: { accessKeyId: "test", secretAccessKey: "test" },
        region: "eu-central-1",
        requestHandler: { handle },
      });
      try {
        const result = await transport.send(prepared());
        expect(result).toMatchObject({ code, outcome });
        expect(handle).toHaveBeenCalledOnce();
        expect(JSON.stringify(result)).not.toContain("recipient@example.com");
      } finally {
        transport.close();
      }
    }
  );

  it("treats a lost transport response as unknown without a hidden SDK retry", async () => {
    const handle = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(
        Object.assign(new Error("connection closed"), { code: "ECONNRESET" })
      );
    const transport = new SesSubmissionTransport({
      configurationSetName: "proof",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
      region: "eu-central-1",
      requestHandler: { handle },
    });
    try {
      await expect(transport.send(prepared())).resolves.toStrictEqual({
        code: "provider_outcome_unknown",
        outcome: "unknown",
      });
      expect(handle).toHaveBeenCalledOnce();
    } finally {
      transport.close();
    }
  });

  it("preserves opaque correlation and requires a provider confirmation ID", async () => {
    const requests: unknown[] = [];
    const input = prepared();
    const transport = new SesSubmissionTransport({
      configurationSetName: "proof",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
      region: "eu-central-1",
      requestHandler: {
        async handle(request: { body?: unknown }) {
          const body =
            request.body instanceof Uint8Array
              ? new TextDecoder().decode(request.body)
              : request.body;
          requests.push(typeof body === "string" ? JSON.parse(body) : null);
          return await Promise.resolve({
            response: {
              body: new TextEncoder().encode(
                JSON.stringify(
                  requests.length === 1 ? { MessageId: "ses-confirmed" } : {}
                )
              ),
              headers: { "content-type": "application/json" },
              statusCode: 200,
            },
          });
        },
      },
    });
    try {
      await expect(transport.send(input)).resolves.toStrictEqual({
        outcome: "accepted",
        providerMessageId: "ses-confirmed",
      });
      expect(responseSchema.parse(requests[0])).toStrictEqual({
        ConfigurationSetName: "proof",
        EmailTags: [
          { Name: "campaign", Value: "fixture" },
          { Name: "quieter_submission", Value: input.submissionId },
          { Name: "quieter_attempt", Value: input.attemptId },
        ],
      });
      await expect(transport.send(input)).resolves.toStrictEqual({
        code: "provider_confirmation_missing",
        outcome: "unknown",
      });
    } finally {
      transport.close();
    }
  });

  it("rejects reserved tag collisions and expired attempts before contacting SES", async () => {
    const handle = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(new Error("must not contact SES"));
    const transport = new SesSubmissionTransport({
      configurationSetName: "proof",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
      region: "eu-central-1",
      requestHandler: { handle },
    });
    try {
      await expect(
        transport.send({
          ...prepared(),
          tags: [{ name: "QUIETER_attempt", value: "forged" }],
        })
      ).resolves.toMatchObject({
        code: "invalid_correlation",
        outcome: "rejected",
      });
      await expect(
        transport.send({ ...prepared(), deadline: new Date(0) })
      ).resolves.toMatchObject({
        code: "attempt_deadline_elapsed",
        outcome: "rejected",
      });
      expect(handle).not.toHaveBeenCalled();
    } finally {
      transport.close();
    }
  });
});
