import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { bearer } from "better-auth/plugins/bearer";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";

import { desktopDeviceAuthorization } from "../src/desktop-device-authorization";

const origin = "http://localhost:3000";

describe("desktop device authorization", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("a desktop code is claimed by one browser session, redeemed once, and rejected after expiry", async () => {
    const auth = betterAuth({
      baseURL: origin,
      database: memoryAdapter({
        account: [],
        deviceCode: [],
        session: [],
        user: [],
        verification: [],
      }),
      emailAndPassword: { enabled: true },
      plugins: [bearer(), desktopDeviceAuthorization],
      secret: "desktop-device-flow-test-secret-0123456789",
    });

    const signUp = async (email: string) => {
      const response = await auth.handler(
        new Request(`${origin}/api/auth/sign-up/email`, {
          body: JSON.stringify({
            email,
            name: email,
            password: "test-passphrase-123",
          }),
          headers: { "content-type": "application/json", origin },
          method: "POST",
        })
      );
      expect(response.status).toBe(200);
      const cookie = response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      expect(cookie).toContain("session_token=");
      return cookie;
    };

    const ownerCookie = await signUp("owner@example.com");
    const otherCookie = await signUp("other@example.com");
    const requestCode = async (clientId: string) =>
      await auth.handler(
        new Request(`${origin}/api/auth/device/code`, {
          body: JSON.stringify({ client_id: clientId }),
          headers: { "content-type": "application/json" },
          method: "POST",
        })
      );

    const unknownClient = await requestCode("unrecognized-client");
    expect(unknownClient.status).toBe(400);

    const issued = await requestCode("quieter-desktop");
    expect(issued.status).toBe(200);
    const code = z
      .object({
        device_code: z.string(),
        user_code: z.string(),
      })
      .parse(await issued.json());

    const verifyUrl = new URL(`${origin}/api/auth/device`);
    verifyUrl.searchParams.set("user_code", code.user_code);
    const ownerVerification = await auth.handler(
      new Request(verifyUrl, { headers: { cookie: ownerCookie } })
    );
    expect(ownerVerification.status).toBe(200);
    await expect(ownerVerification.json()).resolves.toMatchObject({
      client_id: "quieter-desktop",
      status: "pending",
    });

    const otherVerification = await auth.handler(
      new Request(verifyUrl, { headers: { cookie: otherCookie } })
    );
    expect(otherVerification.status).toBe(200);
    await expect(otherVerification.json()).resolves.not.toHaveProperty(
      "client_id"
    );

    const decide = async (cookie: string) =>
      await auth.handler(
        new Request(`${origin}/api/auth/device/approve`, {
          body: JSON.stringify({ userCode: code.user_code }),
          headers: { "content-type": "application/json", cookie, origin },
          method: "POST",
        })
      );
    const otherDecision = await decide(otherCookie);
    expect(otherDecision.status).toBe(403);
    const ownerDecision = await decide(ownerCookie);
    expect(ownerDecision.status).toBe(200);

    const poll = async (deviceCode: string) =>
      await auth.handler(
        new Request(`${origin}/api/auth/device/token`, {
          body: JSON.stringify({
            client_id: "quieter-desktop",
            device_code: deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        })
      );
    const tokenResponse = await poll(code.device_code);
    expect(tokenResponse.status).toBe(200);
    const token = z
      .object({ access_token: z.string().min(1) })
      .parse(await tokenResponse.json());
    const bearerSession = await auth.handler(
      new Request(`${origin}/api/auth/get-session`, {
        headers: { authorization: `Bearer ${token.access_token}` },
      })
    );
    expect(bearerSession.status).toBe(200);
    await expect(bearerSession.json()).resolves.toMatchObject({
      user: { email: "owner@example.com" },
    });
    const repeatedPoll = await poll(code.device_code);
    expect(repeatedPoll.status).toBe(400);

    const expiringResponse = await requestCode("quieter-desktop");
    expect(expiringResponse.status).toBe(200);
    const expiringCode = z
      .object({
        device_code: z.string(),
        user_code: z.string(),
      })
      .parse(await expiringResponse.json());
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1000);
    const expiredUrl = new URL(`${origin}/api/auth/device`);
    expiredUrl.searchParams.set("user_code", expiringCode.user_code);
    const expiredVerification = await auth.handler(
      new Request(expiredUrl, { headers: { cookie: ownerCookie } })
    );
    expect(expiredVerification.status).toBe(400);
    const expiredPoll = await poll(expiringCode.device_code);
    expect(expiredPoll.status).toBe(400);
  });
});
