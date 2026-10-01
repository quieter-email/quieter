import { requireServerEnv, serverEnv } from "@quieter/env/server";

import {
  decryptGmailCredentialSecret,
  encryptGmailCredentialSecret,
} from "../gmail-credential-crypto";

const getEncryptionKeys = () => ({
  currentKey: serverEnv.GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT,
  legacyKey: requireServerEnv("GMAIL_TOKEN_ENCRYPTION_KEY"),
});

export const encryptVerificationCode = (code: string) =>
  encryptGmailCredentialSecret(code, getEncryptionKeys());

export const decryptVerificationCode = (encryptedCode: string) =>
  decryptGmailCredentialSecret(encryptedCode, getEncryptionKeys());
