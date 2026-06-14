import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

type GmailCredentialEncryptionKeys = {
  currentKey?: string;
  legacyKey: string;
};

const deriveEncryptionKey = (secret: string) => createHash("sha256").update(secret).digest();

export const encryptGmailCredentialSecret = (
  value: string,
  keys: GmailCredentialEncryptionKeys,
) => {
  const version = keys.currentKey ? "v2" : "v1";
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    deriveEncryptionKey(keys.currentKey ?? keys.legacyKey),
    iv,
  );
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);

  return [
    version,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
};

export const decryptGmailCredentialSecret = (
  value: string,
  keys: GmailCredentialEncryptionKeys,
) => {
  const parts = value.split(".");
  const [version, iv, tag, encrypted] = parts;
  if (parts.length !== 4 || (version !== "v1" && version !== "v2") || !iv || !tag || !encrypted) {
    throw new Error("Stored Gmail credential is invalid.");
  }

  const secret = version === "v2" ? keys.currentKey : keys.legacyKey;
  if (!secret) {
    throw new Error("Current Gmail credential encryption key is missing.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveEncryptionKey(secret),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};
