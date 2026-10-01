import { configureServerEnv } from "@quieter/env/server";
import { Resource } from "sst";

export const configureMailProcessingSecrets = () => {
  configureServerEnv({
    GMAIL_TOKEN_ENCRYPTION_KEY: Resource.GmailTokenEncryptionKey.value,
    GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT:
      Resource.GmailTokenEncryptionKeyCurrent.value,
    OPENROUTER_API_KEY: Resource.OpenrouterApiKey.value,
    POLAR_ACCESS_TOKEN: Resource.PolarAccessToken.value,
    QUIETER_BACKGROUND_MODEL: Resource.QuieterBackgroundModel.value,
  });
};
