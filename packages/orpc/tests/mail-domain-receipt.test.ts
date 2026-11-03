import type { SESClientConfig } from "@aws-sdk/client-ses";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { ensureReceiptRule } from "../src/mail-domain/service";

const fixture = vi.hoisted(() => {
  const requests: string[] = [];
  return {
    receiptRoleArn: "arn:aws:iam::123456789012:role/fixture-mail-receipt",
    requests,
  };
});

vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    serverEnv: actual.createServerEnv({
      AWS_REGION: "eu-central-1",
      MAIL_BUCKET: "fixture-mail",
      MAIL_RECEIPT_ROLE_ARN: fixture.receiptRoleArn,
      MAIL_RECEIPT_RULE_SET_NAME: "fixture-rules",
      MAIL_RECEIPT_TOPIC_ARN:
        "arn:aws:sns:eu-central-1:123456789012:fixture-mail",
      QUIETER_DEPLOYMENT_ENV: "production",
    }),
  };
});

vi.mock(import("@aws-sdk/client-ses"), async (importOriginal) => {
  const actual = await importOriginal();
  class TransportSesClient extends actual.SESClient {
    constructor(config: SESClientConfig) {
      super({
        ...config,
        credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
        requestHandler: {
          async handle(request: { body?: unknown }) {
            if (typeof request.body !== "string") {
              throw new TypeError("Expected an SES query request body.");
            }
            const { body } = request;
            fixture.requests.push(body);
            const action = new URLSearchParams(body).get("Action");
            return await Promise.resolve({
              response: {
                body: Buffer.from(
                  `<${action}Response xmlns="http://ses.amazonaws.com/doc/2010-12-01/"><ResponseMetadata><RequestId>fixture</RequestId></ResponseMetadata></${action}Response>`
                ),
                headers: { "content-type": "text/xml" },
                statusCode: 200,
              },
            });
          },
        },
      });
    }
  }
  return { ...actual, SESClient: TransportSesClient };
});

describe(ensureReceiptRule, () => {
  beforeEach(() => {
    fixture.requests.length = 0;
  });

  test("passes the configured receipt role to the provider", async () => {
    await ensureReceiptRule("example.test");
    const request = fixture.requests
      .map((body) => new URLSearchParams(body))
      .find((body) => body.get("Action") === "CreateReceiptRule");

    expect(request?.get("Rule.Actions.member.1.S3Action.IamRoleArn")).toBe(
      fixture.receiptRoleArn
    );
  });
});
