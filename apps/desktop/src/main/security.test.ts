import path from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  getAuthCallbackToken,
  getExternalURL,
  isTrustedRendererURL,
  resolveApiTarget,
  resolveRendererFile,
  sanitizeAuthResponse,
} from "./security";

describe("desktop renderer isolation", () => {
  it("attaches credentials only to approved APIs on the configured server", () => {
    expect(
      resolveApiTarget(
        "quieter-app://app/api/orpc/mail/list?mailboxId=one",
        "https://quieter.example"
      )
    ).toMatchObject({
      host: "quieter.example",
      pathname: "/api/orpc/mail/list",
    });
    for (const input of [
      "quieter-app://attacker/api/orpc/mail/list",
      "quieter-app://app/api/auth/electron/token",
      "quieter-app://app/api/auth/get-access-token",
      "quieter-app://app/api/auth/list-sessions",
      "quieter-app://app/api/internal/gmail-credentials/rotate",
      "quieter-app://app/api/%6frpc/mail/list",
      "https://attacker.example/api/orpc/mail/list",
    ]) {
      expect(resolveApiTarget(input, "https://quieter.example")).toBeNull();
    }
  });

  it("serves renderer assets without escaping their directory", () => {
    const root = path.resolve("renderer");
    expect(resolveRendererFile(root, "quieter-app://app/assets/app.js")).toBe(
      path.resolve(root, "assets/app.js")
    );
    expect(
      resolveRendererFile(root, "quieter-app://app/..%2f..%2fcredentials.json")
    ).toBeNull();
    expect(
      resolveRendererFile(root, "quieter-app://app/%5c..%5ccredentials.json")
    ).toBeNull();
    expect(
      resolveRendererFile(root, "quieter-app://elsewhere/assets/app.js")
    ).toBeNull();
  });

  it("accepts IPC only from the local renderer or its exact development origin", () => {
    expect(isTrustedRendererURL("quieter-app://app/inbox")).toBeTruthy();
    expect(
      isTrustedRendererURL(
        "http://127.0.0.1:5173/inbox",
        "http://127.0.0.1:5173"
      )
    ).toBeTruthy();
    expect(
      isTrustedRendererURL(
        "http://127.0.0.1:5174/inbox",
        "http://127.0.0.1:5173"
      )
    ).toBeFalsy();
    expect(
      isTrustedRendererURL("quieter-app://app.attacker/inbox")
    ).toBeFalsy();
  });

  it("validates callback location before the SDK checks PKCE and state", () => {
    expect(
      getAuthCallbackToken("com.quieter.desktop://auth/callback#token=code")
    ).toBe("code");
    for (const input of [
      "https://auth/callback#token=code",
      "com.quieter.desktop://auth/elsewhere#token=code",
      "com.quieter.desktop://attacker/callback#token=code",
      "com.quieter.desktop://auth/callback?redirect=other#token=code",
      "com.quieter.desktop://auth/callback#other=code",
    ]) {
      expect(getAuthCallbackToken(input)).toBeNull();
    }
  });

  it("keeps authentication secrets out of renderer responses", () => {
    const result = sanitizeAuthResponse({
      accounts: [
        {
          accessToken: "provider-secret",
          id: "account",
          refresh_token: "refresh-secret",
        },
      ],
      key: "newly-created-api-key",
      session: { id: "session", token: "session-secret" },
      user: { email: "user@example.test", name: "User" },
    });
    expect(result).toMatchObject({
      accounts: [{ id: "account" }],
      key: "newly-created-api-key",
      session: { id: "session" },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /provider-secret|refresh-secret|session-secret/u
    );
  });

  it("opens ordinary links without handing arbitrary protocols to the OS", () => {
    expect(getExternalURL("https://example.test/mail")).toBe(
      "https://example.test/mail"
    );
    expect(getExternalURL("mailto:hello@example.test")).toBe(
      "mailto:hello@example.test"
    );
    for (const input of [
      "file:///private/credentials",
      // oxlint-disable-next-line eslint/no-script-url -- Verify that the OS never receives script URLs.
      "javascript:alert(1)",
      "shell:AppsFolder",
      "https://user:password@example.test",
      17,
    ]) {
      expect(getExternalURL(input)).toBeNull();
    }
    expect(
      getExternalURL("/settings?tab=account", "https://quieter.example")
    ).toBe("https://quieter.example/settings?tab=account");
    expect(
      getExternalURL("quieter-app://app/api/openapi", "https://quieter.example")
    ).toBe("https://quieter.example/api/openapi");
    expect(
      getExternalURL("//attacker.example", "https://quieter.example")
    ).toBeNull();
    expect(
      getExternalURL("/%5cattacker.example", "https://quieter.example")
    ).toBeNull();
  });
});
