import { z } from "zod";

const configuration = z.strictObject({
  accountId: z.string().regex(/^\d{12}$/u),
  configurationSetName: z.string().regex(/^[\w-]{1,64}$/u),
  enabled: z.boolean(),
  organizationIds: z.array(z.string().min(1).max(128)).min(1).max(100),
  region: z.string().regex(/^[a-z]{2}(?:-[a-z]+)+-\d$/u),
  schemaVersion: z.literal(1),
  stage: z.string().min(1).max(128),
});

const credentials = z.strictObject({
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  sessionToken: z.string().min(1).optional(),
  stage: z.string().min(1).max(128),
});

export const createMailSenderEnv = (runtime: {
  QUIETER_MAIL_SENDER_CONFIG?: string;
  SST_RESOURCE_App?: string;
  SST_RESOURCE_MailSenderCredentials?: string;
}) => {
  if (
    runtime.QUIETER_MAIL_SENDER_CONFIG === undefined ||
    runtime.QUIETER_MAIL_SENDER_CONFIG === ""
  ) {
    return null;
  }
  try {
    const config = configuration.parse(
      JSON.parse(runtime.QUIETER_MAIL_SENDER_CONFIG)
    );
    if (!config.enabled) {
      return null;
    }
    const app = z
      .object({ stage: z.string() })
      .parse(JSON.parse(runtime.SST_RESOURCE_App ?? ""));
    const secret = z
      .object({ value: z.string() })
      .parse(JSON.parse(runtime.SST_RESOURCE_MailSenderCredentials ?? ""));
    const { stage, ...awsCredentials } = credentials.parse(
      JSON.parse(secret.value)
    );
    if (app.stage !== config.stage || stage !== config.stage) {
      throw new Error("Mail sender stage mismatch.");
    }
    return { ...config, credentials: awsCredentials };
  } catch {
    throw new Error("Invalid mail sender configuration or linked credentials.");
  }
};
