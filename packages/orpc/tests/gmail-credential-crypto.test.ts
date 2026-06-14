import { describe, expect, test } from "bun:test";
import {
  decryptGmailCredentialSecret,
  encryptGmailCredentialSecret,
} from "../src/gmail-credential-crypto";

const keys = {
  currentKey: "current-encryption-key",
  legacyKey: "legacy-encryption-key",
};

describe("Gmail credential encryption", () => {
  test("writes and reads current-key credentials", () => {
    const encrypted = encryptGmailCredentialSecret("access-token", keys);

    expect(encrypted.startsWith("v2.")).toBe(true);
    expect(decryptGmailCredentialSecret(encrypted, keys)).toBe("access-token");
  });

  test("keeps legacy credentials readable during rotation", () => {
    const encrypted = encryptGmailCredentialSecret("refresh-token", {
      legacyKey: keys.legacyKey,
    });

    expect(encrypted.startsWith("v1.")).toBe(true);
    expect(decryptGmailCredentialSecret(encrypted, keys)).toBe("refresh-token");
  });

  test("does not read current credentials without the current key", () => {
    const encrypted = encryptGmailCredentialSecret("access-token", keys);

    expect(() => decryptGmailCredentialSecret(encrypted, { legacyKey: keys.legacyKey })).toThrow(
      "Current Gmail credential encryption key is missing.",
    );
  });
});
