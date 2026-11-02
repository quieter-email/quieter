import { randomBytes } from "node:crypto";

import { generateCodeChallenge } from "better-auth/oauth2";
import { describe, expect, test } from "vite-plus/test";

import { DESKTOP_AUTH_CLIENT_ID, desktopAuthQuerySchema } from "../src/desktop";

describe("desktop browser handoff", () => {
  test("accepts an S256 challenge and drops untrusted redirect parameters", async () => {
    const challenge = await generateCodeChallenge(
      randomBytes(32).toString("base64url")
    );
    const result = desktopAuthQuerySchema.safeParse({
      callbackURL: "https://untrusted.example/",
      client_id: DESKTOP_AUTH_CLIENT_ID,
      code_challenge: challenge,
      state: randomBytes(8).toString("hex"),
    });

    expect(result.success).toBeTruthy();
    expect(result.data).not.toHaveProperty("callbackURL");
  });

  test.each([
    { client_id: "another-application" },
    { code_challenge: "plaintext-verifier" },
    { code_challenge: `${"A".repeat(42)}/` },
    { state: "" },
    { state: "../auth/callback" },
  ])("rejects malformed or foreign authentication requests: %o", (change) => {
    const result = desktopAuthQuerySchema.safeParse({
      client_id: DESKTOP_AUTH_CLIENT_ID,
      code_challenge: randomBytes(32).toString("base64url"),
      state: randomBytes(8).toString("hex"),
      ...change,
    });

    expect(result.success).toBeFalsy();
  });
});
