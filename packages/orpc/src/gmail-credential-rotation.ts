import { db } from "@quieter/database/client";
import { gmailCredential } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { like, or } from "drizzle-orm";
import { rotateGmailCredentialSecrets } from "./gmail-mailbox-access";

export const rotateLegacyGmailCredentials = async () => {
  if (!serverEnv.GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT) {
    return { rotated: 0 };
  }

  let rotated = 0;

  while (true) {
    const credentials = await db
      .select({
        encryptedAccessToken: gmailCredential.encryptedAccessToken,
        encryptedRefreshToken: gmailCredential.encryptedRefreshToken,
        id: gmailCredential.mailboxId,
      })
      .from(gmailCredential)
      .where(
        or(
          like(gmailCredential.encryptedAccessToken, "v1.%"),
          like(gmailCredential.encryptedRefreshToken, "v1.%"),
        ),
      )
      .limit(50);

    if (credentials.length === 0) {
      return { rotated };
    }

    const results = await Promise.all(credentials.map(rotateGmailCredentialSecrets));
    const rotatedInBatch = results.filter((result) => result.rotated).length;
    if (rotatedInBatch === 0) {
      throw new Error("Stored Gmail credentials could not be rotated.");
    }
    rotated += rotatedInBatch;
  }
};
