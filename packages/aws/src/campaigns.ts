import { withRequestDatabaseClient } from "@quieter/database/client";
import { configureServerEnv } from "@quieter/env/server";
import { Resource } from "sst";

export const handler = async () => {
  configureServerEnv({
    DATABASE_URL: Resource.DatabaseUrl.value,
    POLAR_ACCESS_TOKEN: Resource.PolarAccessToken.value,
    R2_ACCESS_KEY_ID: Resource.R2AccessKeyId.value,
    R2_SECRET_ACCESS_KEY: Resource.R2SecretAccessKey.value,
    SENTRY_DSN: Resource.SentryDsn.value,
  });
  const { reportAwsError } = await import("./sentry");
  const { processCampaignBatch } =
    await import("@quieter/orpc/campaigns/processor");
  const { recoverMailSends } = await import("@quieter/orpc/mail-send");
  try {
    return await withRequestDatabaseClient(async () => {
      await recoverMailSends();
      return await processCampaignBatch();
    });
  } catch (error) {
    await reportAwsError(error, "CampaignProcessor");
    throw error;
  }
};
