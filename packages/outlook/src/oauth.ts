import { createHash, randomBytes } from "node:crypto";

import { createRemoteJWKSet, customFetch, decodeJwt, jwtVerify } from "jose";
import { z } from "zod";

export type OutlookOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type OutlookOAuthToken = {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken?: string;
  scopes: string;
};

export type OutlookOAuthAccount = {
  issuer: string;
  subject: string;
  tenantId: string;
};

export class OutlookOAuthError extends Error {
  readonly code:
    | "invalid_grant"
    | "invalid_response"
    | "missing_scopes"
    | "temporary";

  constructor(code: OutlookOAuthError["code"]) {
    super("The mailbox connection could not authorize its access.");
    this.code = code;
    this.name = "OutlookOAuthError";
  }
}

const readScopes = "openid profile offline_access User.Read Mail.Read";
const authority = "https://login.microsoftonline.com";
const configSchema = z.object({
  clientId: z
    .string()
    .min(1)
    .refine((value) => value.trim() === value),
  clientSecret: z.string().min(1),
  redirectUri: z.url().refine((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)))
    );
  }),
});
const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  id_token: z.string().min(1).optional(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().trim().min(1),
  token_type: z.string().refine((value) => value.toLowerCase() === "bearer"),
});
const tenantSchema = z
  .string()
  .regex(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu);
const claimsSchema = z.object({
  aud: z.string().min(1),
  iss: z.string().min(1),
  nonce: z.string().min(1),
  sub: z.string().min(1),
  tid: tenantSchema,
});
const jwksSchema = z.object({
  keys: z.array(z.looseObject({ issuer: z.string().optional() })).min(1),
});

const readBoundedJson = async (response: Response): Promise<unknown> => {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new OutlookOAuthError("invalid_response");
  }
  let bytes = 0;
  let content = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > 65_536) {
        await reader.cancel();
        throw new OutlookOAuthError("invalid_response");
      }
      content += decoder.decode(chunk.value, { stream: true });
    }
    content += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new OutlookOAuthError("invalid_response");
  }
};

const requestToken = async (input: {
  config: OutlookOAuthConfig;
  grant:
    | { code: string; codeVerifier: string; kind: "authorization_code" }
    | { kind: "refresh_token"; refreshToken: string };
  signal?: AbortSignal;
}) => {
  const config = configSchema.safeParse(input.config);
  if (!config.success) {
    throw new OutlookOAuthError("invalid_response");
  }
  const parameters = new URLSearchParams({
    client_id: config.data.clientId,
    client_secret: config.data.clientSecret,
    grant_type: input.grant.kind,
    scope: readScopes,
  });
  if (input.grant.kind === "authorization_code") {
    parameters.set("code", input.grant.code);
    parameters.set("code_verifier", input.grant.codeVerifier);
    parameters.set("redirect_uri", config.data.redirectUri);
  } else {
    parameters.set("refresh_token", input.grant.refreshToken);
  }
  try {
    const response = await fetch(`${authority}/common/oauth2/v2.0/token`, {
      body: parameters,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
      redirect: "manual",
      signal: input.signal
        ? AbortSignal.any([input.signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
    });
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      throw new OutlookOAuthError("temporary");
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new OutlookOAuthError("invalid_response");
    }
    const body = await readBoundedJson(response);
    if (!response.ok) {
      const error = z.object({ error: z.string() }).safeParse(body);
      if (
        error.success &&
        ["consent_required", "interaction_required", "invalid_grant"].includes(
          error.data.error
        )
      ) {
        throw new OutlookOAuthError("invalid_grant");
      }
      if (error.success && error.data.error === "invalid_scope") {
        throw new OutlookOAuthError("missing_scopes");
      }
      throw new OutlookOAuthError("invalid_response");
    }
    const token = tokenSchema.safeParse(body);
    if (!token.success) {
      throw new OutlookOAuthError("invalid_response");
    }
    const scopes = new Set(
      token.data.scope
        .split(/\s+/u)
        .map((scope) =>
          scope
            .replace(/^https:\/\/graph\.microsoft\.com\//iu, "")
            .toLowerCase()
        )
    );
    if (!scopes.has("user.read") || !scopes.has("mail.read")) {
      throw new OutlookOAuthError("missing_scopes");
    }
    const accessTokenExpiresAt = new Date(
      Date.now() + token.data.expires_in * 1000
    );
    if (Number.isNaN(accessTokenExpiresAt.getTime())) {
      throw new OutlookOAuthError("invalid_response");
    }
    return { accessTokenExpiresAt, token: token.data };
  } catch (error) {
    if (error instanceof OutlookOAuthError) {
      throw error;
    }
    throw new OutlookOAuthError("temporary");
  }
};

export const createOutlookAuthorizationRequest = (
  input: OutlookOAuthConfig
): {
  authorizationUrl: string;
  codeVerifier: string;
  nonce: string;
  state: string;
} => {
  const config = configSchema.safeParse(input);
  if (!config.success) {
    throw new OutlookOAuthError("invalid_response");
  }
  const codeVerifier = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const authorizationUrl = new URL(`${authority}/common/oauth2/v2.0/authorize`);
  authorizationUrl.search = new URLSearchParams({
    client_id: config.data.clientId,
    code_challenge: createHash("sha256")
      .update(codeVerifier)
      .digest("base64url"),
    code_challenge_method: "S256",
    nonce,
    prompt: "select_account",
    redirect_uri: config.data.redirectUri,
    response_mode: "query",
    response_type: "code",
    scope: readScopes,
    state,
  }).toString();
  return {
    authorizationUrl: authorizationUrl.href,
    codeVerifier,
    nonce,
    state,
  };
};

export const exchangeOutlookAuthorizationCode = async (input: {
  code: string;
  codeVerifier: string;
  config: OutlookOAuthConfig;
  nonce: string;
  signal?: AbortSignal;
}): Promise<
  OutlookOAuthToken & { account: OutlookOAuthAccount; refreshToken: string }
> => {
  const { accessTokenExpiresAt, token } = await requestToken({
    config: input.config,
    grant: {
      code: input.code,
      codeVerifier: input.codeVerifier,
      kind: "authorization_code",
    },
    signal: input.signal,
  });
  if (token.id_token === undefined || token.refresh_token === undefined) {
    throw new OutlookOAuthError("invalid_response");
  }
  try {
    const unverified = z
      .object({ tid: tenantSchema })
      .parse(decodeJwt(token.id_token));
    const issuer = `${authority}/${unverified.tid}/v2.0`;
    const keys = createRemoteJWKSet(
      new URL(`${authority}/${unverified.tid}/discovery/v2.0/keys`),
      {
        [customFetch]: async (url, options) => {
          const response = await fetch(url, {
            ...options,
            signal: input.signal
              ? AbortSignal.any([input.signal, options.signal])
              : options.signal,
          });
          if (response.status === 429 || response.status >= 500) {
            await response.body?.cancel();
            throw new OutlookOAuthError("temporary");
          }
          const document = jwksSchema.safeParse(
            await readBoundedJson(response)
          );
          if (!document.success) {
            throw new OutlookOAuthError("invalid_response");
          }
          const trustedKeys = document.data.keys.filter(
            (key) =>
              key.issuer === undefined ||
              key.issuer.replaceAll(/\{tenantid\}/giu, unverified.tid) ===
                issuer
          );
          if (trustedKeys.length === 0) {
            throw new OutlookOAuthError("invalid_response");
          }
          return Response.json(
            { keys: trustedKeys },
            {
              status: response.status,
            }
          );
        },
        timeoutDuration: 10_000,
      }
    );
    const verified = await jwtVerify(token.id_token, keys, {
      algorithms: ["RS256"],
      audience: input.config.clientId,
      issuer,
      maxTokenAge: "10 minutes",
      requiredClaims: ["exp", "iat", "nbf", "nonce", "sub", "tid"],
    });
    const account = claimsSchema.parse(verified.payload);
    if (account.nonce !== input.nonce || account.tid !== unverified.tid) {
      throw new OutlookOAuthError("invalid_response");
    }
    return {
      accessToken: token.access_token,
      accessTokenExpiresAt,
      account: {
        issuer: account.iss,
        subject: account.sub,
        tenantId: account.tid,
      },
      refreshToken: token.refresh_token,
      scopes: token.scope,
    };
  } catch (error) {
    if (error instanceof OutlookOAuthError) {
      throw error;
    }
    if (
      error instanceof TypeError ||
      (error instanceof Error &&
        ["AbortError", "JWKSTimeout", "TimeoutError"].includes(error.name))
    ) {
      throw new OutlookOAuthError("temporary");
    }
    throw new OutlookOAuthError("invalid_response");
  }
};

export const refreshOutlookAccessToken = async (input: {
  config: OutlookOAuthConfig;
  refreshToken: string;
  signal?: AbortSignal;
}): Promise<OutlookOAuthToken> => {
  const { accessTokenExpiresAt, token } = await requestToken({
    config: input.config,
    grant: { kind: "refresh_token", refreshToken: input.refreshToken },
    signal: input.signal,
  });
  return {
    accessToken: token.access_token,
    accessTokenExpiresAt,
    refreshToken: token.refresh_token,
    scopes: token.scope,
  };
};
