import { createHash } from "node:crypto";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { JWTPayload } from "jose";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import {
  createOutlookAuthorizationRequest,
  exchangeOutlookAuthorizationCode,
  OutlookOAuthError,
  refreshOutlookAccessToken,
} from "../src/oauth";

const tenantId = "c9bf9e57-1685-4c89-bafb-ff5af830be8a";
const config = {
  clientId: "mail-fixture-client",
  clientSecret: "synthetic-client-secret",
  redirectUri: "http://127.0.0.1:3490/api/outlook/callback",
};
const exchange = {
  code: "synthetic-code",
  codeVerifier: "synthetic-verifier",
  config,
  nonce: "expected-connection-nonce",
};
const tokenBody = {
  access_token: "opaque-graph-access-token",
  expires_in: 3600,
  refresh_token: "synthetic-refresh-token",
  scope: "User.Read Mail.Read",
  token_type: "Bearer",
};
let trustedKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let untrustedKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let publicJwk: Awaited<ReturnType<typeof exportJWK>>;

const signIdentity = async (input?: {
  claims?: JWTPayload;
  jku?: string;
  untrusted?: boolean;
}) => {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    aud: config.clientId,
    exp: now + 300,
    iat: now,
    iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    nbf: now - 5,
    nonce: exchange.nonce,
    sub: "fixture-external-subject",
    tid: tenantId,
    ...input?.claims,
  })
    .setProtectedHeader({
      alg: "RS256",
      ...(input?.jku ? { jku: input.jku } : {}),
      kid: "fixture-key",
    })
    .sign(
      input?.untrusted === true
        ? untrustedKeys.privateKey
        : trustedKeys.privateKey
    );
};

const installResponses = (body: unknown, status = 200, keyIssuer?: string) => {
  const request = vi.fn<typeof fetch>(async (resource, options) => {
    const url = new URL(
      typeof resource === "string" || resource instanceof URL
        ? resource
        : resource.url
    );
    if (url.origin !== "https://login.microsoftonline.com") {
      throw new Error("An untrusted identity host was requested.");
    }
    if (url.pathname === "/common/oauth2/v2.0/token") {
      const parameters = await new Request(url, options).formData();
      expect(parameters.get("client_id")).toBe(config.clientId);
      expect(parameters.get("client_secret")).toBe(config.clientSecret);
      expect(options?.redirect).toBe("manual");
      return Response.json(body, { status });
    }
    if (url.pathname === `/${tenantId}/discovery/v2.0/keys`) {
      expect(options?.redirect).toBe("manual");
      return Response.json({
        keys: [
          {
            ...publicJwk,
            ...(keyIssuer ? { issuer: keyIssuer } : {}),
            kid: "fixture-key",
          },
        ],
      });
    }
    throw new Error("An unexpected identity resource was requested.");
  });
  vi.stubGlobal("fetch", request);
  return request;
};

describe("Outlook mail OAuth", () => {
  beforeAll(async () => {
    trustedKeys = await generateKeyPair("RS256");
    untrustedKeys = await generateKeyPair("RS256");
    publicJwk = await exportJWK(trustedKeys.publicKey);
  });
  afterEach(() => vi.unstubAllGlobals());

  test("binds fresh state and nonce to S256 mail consent without Calendar access", () => {
    const first = createOutlookAuthorizationRequest(config);
    const second = createOutlookAuthorizationRequest(config);
    const url = new URL(first.authorizationUrl);
    expect(first.state).not.toBe(second.state);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.codeVerifier).not.toBe(second.codeVerifier);
    expect(url.searchParams.get("state")).toBe(first.state);
    expect(url.searchParams.get("nonce")).toBe(first.nonce);
    expect(url.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(first.codeVerifier).digest("base64url")
    );
    expect(url.searchParams.get("scope")).toMatch(/\bMail.Read\b/u);
    expect(url.searchParams.get("scope")).not.toMatch(
      /Calendars|Mail.Send|Shared/u
    );
    expect(url.searchParams.get("client_secret")).toBeNull();
  });

  test.each([
    "http://attacker.example/callback",
    "http://localhost.attacker.example/callback",
    "https://user:secret@quieter.example/callback",
    "https://quieter.example/callback#fragment",
    "not-a-url",
  ])("rejects unsafe configured redirect %s", (redirectUri) => {
    expect(() =>
      createOutlookAuthorizationRequest({ ...config, redirectUri })
    ).toThrow(OutlookOAuthError);
  });

  test("verifies the connected account while treating Graph access tokens as opaque", async () => {
    installResponses({ ...tokenBody, id_token: await signIdentity() });
    const result = await exchangeOutlookAuthorizationCode(exchange);
    expect(result).toMatchObject({
      accessToken: tokenBody.access_token,
      account: {
        issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
        subject: "fixture-external-subject",
        tenantId,
      },
      refreshToken: tokenBody.refresh_token,
    });
    expect(result.accessTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  test.each([
    { aud: "calendar-client" },
    { aud: [config.clientId, "another-client"] },
    { iss: "https://attacker.example/issuer" },
    { nonce: "another-connection" },
    { exp: 1 },
    { exp: undefined },
    { iat: undefined },
    { iat: 4_000_000_000 },
    { nbf: 4_000_000_000 },
  ])("rejects an identity with invalid claims %j", async (claims) => {
    installResponses({
      ...tokenBody,
      id_token: await signIdentity({ claims }),
    });
    await expect(
      exchangeOutlookAuthorizationCode(exchange)
    ).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  test("rejects a forged signature instead of accepting its claimed identity", async () => {
    installResponses({
      ...tokenBody,
      id_token: await signIdentity({ untrusted: true }),
    });
    await expect(
      exchangeOutlookAuthorizationCode(exchange)
    ).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  test("rejects a signing key scoped to another tenant", async () => {
    installResponses(
      { ...tokenBody, id_token: await signIdentity() },
      200,
      "https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0"
    );
    await expect(
      exchangeOutlookAuthorizationCode(exchange)
    ).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  test("binds a templated signing-key issuer to the token's validated tenant", async () => {
    installResponses(
      { ...tokenBody, id_token: await signIdentity() },
      200,
      "https://login.microsoftonline.com/{tenantid}/v2.0"
    );
    await expect(
      exchangeOutlookAuthorizationCode(exchange)
    ).resolves.toMatchObject({
      account: { tenantId },
    });
  });

  test.each([undefined, Number.MAX_SAFE_INTEGER, 0, "3600"])(
    "rejects an unusable token expiry %s",
    async (expires_in) => {
      installResponses({
        ...tokenBody,
        expires_in,
        id_token: await signIdentity(),
      });
      await expect(
        exchangeOutlookAuthorizationCode(exchange)
      ).rejects.toMatchObject({
        code: "invalid_response",
      });
    }
  );

  test("requires refresh capability before creating an offline connection", async () => {
    installResponses({
      ...tokenBody,
      id_token: await signIdentity(),
      refresh_token: undefined,
    });
    await expect(
      exchangeOutlookAuthorizationCode(exchange)
    ).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  test("ignores a token-supplied JWKS URL and uses only the trusted authority", async () => {
    const request = installResponses({
      ...tokenBody,
      id_token: await signIdentity({ jku: "https://attacker.example/keys" }),
    });
    await expect(
      exchangeOutlookAuthorizationCode(exchange)
    ).resolves.toMatchObject({
      account: { tenantId },
    });
    expect(
      request.mock.calls.every(([resource]) => {
        const url = new URL(
          typeof resource === "string" || resource instanceof URL
            ? resource
            : resource.url
        );
        return url.origin === "https://login.microsoftonline.com";
      })
    ).toBeTruthy();
  });

  test.each(["../../attacker", "https://attacker.example", "not-a-tenant"])(
    "rejects an untrusted tenant path %s before requesting its keys",
    async (tid) => {
      const request = installResponses({
        ...tokenBody,
        id_token: await signIdentity({ claims: { tid } }),
      });
      await expect(
        exchangeOutlookAuthorizationCode(exchange)
      ).rejects.toMatchObject({
        code: "invalid_response",
      });
      expect(
        request.mock.calls.some(([resource]) => {
          const url = new URL(
            typeof resource === "string" || resource instanceof URL
              ? resource
              : resource.url
          );
          return url.pathname.endsWith("/keys");
        })
      ).toBeFalsy();
    }
  );

  test.each(["User.Read Calendars.ReadWrite", "Mail.Read"])(
    "rejects consent that does not grant complete mail read access %s",
    async (scope) => {
      installResponses({ ...tokenBody, id_token: await signIdentity(), scope });
      await expect(
        exchangeOutlookAuthorizationCode(exchange)
      ).rejects.toMatchObject({
        code: "missing_scopes",
      });
    }
  );

  test.each([
    { body: { error: "invalid_grant" }, code: "invalid_grant", status: 400 },
    { body: { error: "consent_required" }, code: "invalid_grant", status: 400 },
    { body: { error: "invalid_scope" }, code: "missing_scopes", status: 400 },
    {
      body: { error: "temporarily_unavailable" },
      code: "temporary",
      status: 503,
    },
    { body: { error: "throttled" }, code: "temporary", status: 429 },
  ])(
    "classifies token failure without leaking its response %j",
    async ({ body, code, status }) => {
      const sensitive = "provider-token-and-secret-must-stay-private";
      installResponses({ ...body, error_description: sensitive }, status);
      const failure: unknown = await refreshOutlookAccessToken({
        config,
        refreshToken: "synthetic-token",
      }).catch((error: unknown) => error);
      expect(failure).toMatchObject({ code });
      expect(String(failure)).not.toContain(sensitive);
      expect(failure).not.toHaveProperty("cause");
    }
  );

  test("keeps an omitted rotated refresh token absent for the credential owner to preserve", async () => {
    installResponses({
      access_token: "replacement-access-token",
      expires_in: 3000,
      scope:
        "https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read",
      token_type: "Bearer",
    });
    const result = await refreshOutlookAccessToken({
      config,
      refreshToken: "existing-refresh-token",
    });
    expect(result.accessToken).toBe("replacement-access-token");
    expect(result.refreshToken).toBeUndefined();
    expect(result.accessTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  test("does not follow a token redirect with credentials", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        headers: { location: "https://attacker.example/token" },
        status: 302,
      })
    );
    vi.stubGlobal("fetch", request);
    await expect(
      refreshOutlookAccessToken({ config, refreshToken: "synthetic-token" })
    ).rejects.toMatchObject({ code: "invalid_response" });
    expect(
      request.mock.calls.every(([, options]) => options?.redirect === "manual")
    ).toBeTruthy();
  });

  test("sanitizes transport failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new Error(config.clientSecret))
    );
    const failure: unknown = await refreshOutlookAccessToken({
      config,
      refreshToken: "synthetic-token",
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "temporary" });
    expect(String(failure)).not.toContain(config.clientSecret);
  });
});
