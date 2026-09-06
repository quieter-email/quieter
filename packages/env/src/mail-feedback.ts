import { z } from "zod";

import type { RuntimeEnvironment } from "./schema.ts";

const configuration = z.strictObject({
  enabled: z.boolean(),
  endpoint: z.url(),
  queueArn: z.string().regex(/^arn:aws:sqs:[a-z\d-]+:\d{12}:[\w-]+$/u),
  schemaVersion: z.literal(1),
  stage: z.string().min(1).max(128),
  topicArn: z.string().regex(/^arn:aws:sns:[a-z\d-]+:\d{12}:[\w-]+$/u),
});

export const createMailFeedbackEnv = (
  runtime: RuntimeEnvironment = process.env
) => {
  if (
    runtime.QUIETER_MAIL_FEEDBACK_CONFIG === undefined ||
    runtime.QUIETER_MAIL_FEEDBACK_CONFIG === ""
  ) {
    return null;
  }
  try {
    const config = configuration.parse(
      JSON.parse(runtime.QUIETER_MAIL_FEEDBACK_CONFIG)
    );
    if (!config.enabled) {
      return null;
    }
    const endpoint = new URL(config.endpoint);
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username !== "" ||
      endpoint.password !== "" ||
      endpoint.search !== "" ||
      endpoint.hash !== "" ||
      endpoint.pathname !== "/internal/mail/feedback"
    ) {
      throw new Error("Invalid feedback endpoint.");
    }
    const [region, account] = config.topicArn.split(":").slice(3, 5);
    if (!config.queueArn.startsWith(`arn:aws:sqs:${region}:${account}:`)) {
      throw new Error("Feedback queue and source differ.");
    }
    const app: unknown =
      runtime.SST_RESOURCES_JSON === undefined
        ? JSON.parse(runtime.SST_RESOURCE_App ?? "")
        : undefined;
    const token: unknown =
      runtime.SST_RESOURCES_JSON === undefined
        ? JSON.parse(runtime.SST_RESOURCE_MailFeedbackBridgeToken ?? "")
        : undefined;
    const links = z
      .object({
        App: z.object({ stage: z.string() }),
        MailFeedbackBridgeToken: z.object({ value: z.string() }),
      })
      .parse(
        runtime.SST_RESOURCES_JSON === undefined
          ? {
              App: app,
              MailFeedbackBridgeToken: token,
            }
          : JSON.parse(runtime.SST_RESOURCES_JSON)
      );
    const secret = z
      .strictObject({
        stage: z.string(),
        token: z.string().regex(/^[a-f\d]{64}$/u),
      })
      .parse(JSON.parse(links.MailFeedbackBridgeToken.value));
    if (links.App.stage !== config.stage || secret.stage !== config.stage) {
      throw new Error("Feedback stage mismatch.");
    }
    return { ...config, region, token: secret.token };
  } catch {
    throw new Error("Invalid mail feedback configuration or linked token.");
  }
};
