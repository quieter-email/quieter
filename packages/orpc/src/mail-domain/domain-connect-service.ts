import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { mailDomain, mailDomainConnectAttempt } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  buildDomainConnectApplyUrl,
  discoverDomainConnect,
  DOMAIN_CONNECT_STATE_TTL_MS,
  getDomainConnectService,
} from "./domain-connect";
import { assertUserCanManageMailDomains, assertUserOrganizationMember } from "./service";
import { verifyMailDomainSetup } from "./verification";

const getDomainConnectPrivateKey = () => {
  const encoded = serverEnv.DOMAIN_CONNECT_PRIVATE_KEY_B64;
  if (!encoded) return null;
  const privateKey = Buffer.from(encoded, "base64").toString("utf8");
  return privateKey.includes("BEGIN PRIVATE KEY") ? privateKey : null;
};

const getDomainConnectReturnTo = (organizationId: string, domainId: string) => {
  const search = new URLSearchParams({
    domainId,
    organizationId,
    organizationView: "domains",
    tab: "organization",
  });
  return `/settings?${search}`;
};

const getDomainForConnect = async (input: { domainId: string; organizationId: string }) => {
  const [domain] = await db
    .select({
      domain: mailDomain.domain,
      id: mailDomain.id,
      mode: mailDomain.mode,
      requiredDnsRecords: mailDomain.requiredDnsRecords,
    })
    .from(mailDomain)
    .where(
      and(eq(mailDomain.id, input.domainId), eq(mailDomain.organizationId, input.organizationId)),
    )
    .limit(1);
  if (!domain) {
    throw new ORPCError("NOT_FOUND", {
      message: "Mail domain was not found in the active team.",
    });
  }
  return domain;
};

export const getDomainConnectAvailability = async (input: {
  domainId: string;
  organizationId: string;
  userId: string;
}) => {
  await assertUserOrganizationMember(input);
  const domain = await getDomainForConnect(input);
  return discoverDomainConnect({
    configured: !!getDomainConnectPrivateKey() && !!serverEnv.BETTER_AUTH_URL,
    domain: domain.domain,
    mode: domain.mode,
  });
};

export const startDomainConnect = async (input: {
  domainId: string;
  organizationId: string;
  userId: string;
}) => {
  await assertUserCanManageMailDomains(input);
  const domain = await getDomainForConnect(input);
  const privateKey = getDomainConnectPrivateKey();
  const baseUrl = serverEnv.BETTER_AUTH_URL?.replace(/\/+$/, "");
  if (!privateKey || !baseUrl) {
    throw new ORPCError("BAD_REQUEST", {
      message: "One-click DNS setup is not configured in this environment.",
    });
  }

  const discovery = await discoverDomainConnect({
    configured: true,
    domain: domain.domain,
    mode: domain.mode,
  });
  if (!discovery.available) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This DNS provider does not support Quieter one-click setup yet.",
    });
  }

  const state = randomUUID();
  const now = new Date();
  const service = getDomainConnectService(domain.mode);
  await db.insert(mailDomainConnectAttempt).values({
    callbackError: null,
    consumedAt: null,
    createdAt: now,
    domainId: domain.id,
    expiresAt: new Date(now.getTime() + DOMAIN_CONNECT_STATE_TTL_MS),
    id: state,
    mode: domain.mode,
    organizationId: input.organizationId,
    providerId: discovery.provider.id,
    providerName: discovery.provider.displayName,
    serviceId: service.id,
    status: "pending",
    templateVersion: service.version,
    updatedAt: now,
    userId: input.userId,
  });

  return {
    authorizationUrl: buildDomainConnectApplyUrl({
      callbackUrl: `${baseUrl}/api/domain-connect/callback?state=${encodeURIComponent(state)}`,
      domain: domain.domain,
      mode: domain.mode,
      privateKey,
      provider: discovery.provider,
      records: domain.requiredDnsRecords,
      state,
    }),
    providerName: discovery.provider.displayName,
  };
};

export const completeDomainConnect = async (input: {
  error: string | null;
  headers: Headers;
  state: string;
}) => {
  const { auth } = await import("@quieter/auth");
  const session = await auth.api.getSession({ headers: input.headers });
  if (!session?.user || !session.session) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Sign in before completing domain setup.",
    });
  }

  const [attempt] = await db
    .select()
    .from(mailDomainConnectAttempt)
    .where(eq(mailDomainConnectAttempt.id, input.state))
    .limit(1);
  const now = new Date();
  if (!attempt || attempt.userId !== session.user.id || attempt.consumedAt) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This one-click DNS request is invalid or has already been used.",
    });
  }
  if (attempt.expiresAt.getTime() <= now.getTime()) {
    await db
      .update(mailDomainConnectAttempt)
      .set({ status: "expired", updatedAt: now })
      .where(
        and(
          eq(mailDomainConnectAttempt.id, attempt.id),
          isNull(mailDomainConnectAttempt.consumedAt),
        ),
      );
    throw new ORPCError("BAD_REQUEST", {
      message: "This one-click DNS request has expired.",
    });
  }

  await assertUserCanManageMailDomains({
    organizationId: attempt.organizationId,
    userId: session.user.id,
  });
  const domain = await getDomainForConnect({
    domainId: attempt.domainId,
    organizationId: attempt.organizationId,
  });
  if (domain.mode !== attempt.mode) {
    throw new ORPCError("BAD_REQUEST", {
      message: "The domain mode changed during setup. Start one-click setup again.",
    });
  }

  const callbackStatus =
    input.error == null
      ? "returned"
      : input.error === "access_denied" || input.error.startsWith("user_cancel")
        ? "canceled"
        : "failed";
  const [consumedAttempt] = await db
    .update(mailDomainConnectAttempt)
    .set({
      callbackError: input.error,
      consumedAt: now,
      status: callbackStatus,
      updatedAt: now,
    })
    .where(
      and(
        eq(mailDomainConnectAttempt.id, attempt.id),
        eq(mailDomainConnectAttempt.userId, session.user.id),
        isNull(mailDomainConnectAttempt.consumedAt),
        gt(mailDomainConnectAttempt.expiresAt, now),
      ),
    )
    .returning({ id: mailDomainConnectAttempt.id });
  if (!consumedAttempt) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This one-click DNS request is invalid or has already been used.",
    });
  }

  const returnTo = getDomainConnectReturnTo(attempt.organizationId, attempt.domainId);
  if (input.error) {
    return { result: callbackStatus, returnTo };
  }

  const verification = await verifyMailDomainSetup({
    domainId: attempt.domainId,
    organizationId: attempt.organizationId,
  });
  return {
    result: verification.status === "verified" ? ("verified" as const) : ("needs_dns" as const),
    returnTo,
  };
};
