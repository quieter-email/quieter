import { requireServerEnv, serverEnv } from "@quieter/env/server";

import {
  decryptGmailCredentialSecret,
  encryptGmailCredentialSecret,
} from "../gmail-credential-crypto";

export const encryptVerificationCode = (code: string) =>
  encryptGmailCredentialSecret(code, {
    currentKey: serverEnv.GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT,
    legacyKey: requireServerEnv("GMAIL_TOKEN_ENCRYPTION_KEY"),
  });

export const decryptVerificationCode = (encryptedCode: string) =>
  decryptGmailCredentialSecret(encryptedCode, {
    currentKey: serverEnv.GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT,
    legacyKey: requireServerEnv("GMAIL_TOKEN_ENCRYPTION_KEY"),
  });
