import { db } from "@quieter/database/client";
import { account, mailbox, member, user } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { auth } from "./index";
import { ensureUserOrganizationState } from "./organization";

export const previewPersonaCookieName = "quieter_preview_persona";
export const previewPersonaCookieMaxAgeSeconds = 60 * 60 * 24 * 7;
export const previewPersonas = ["gmail", "managed", "empty"] as const;

export type PreviewPersona = (typeof previewPersonas)[number];

export type PreviewSessionUser = {
  email: string;
  emailVerified: boolean;
  id: string;
  image: string | null;
  name: string;
};

type PersonaAccount = PreviewSessionUser & {
  mailbox: {
    displayName: string;
    emailAddress: string;
    id: string;
    provider: "gmail" | "managed";
  } | null;
};

const previewPersonaUsers: Record<PreviewPersona, PersonaAccount> = {
  empty: {
    email: "empty.preview@quieter.email",
    emailVerified: true,
    id: "preview-empty-user",
    image: null,
    mailbox: null,
    name: "Empty Preview",
  },
  gmail: {
    email: "gmail.preview@quieter.email",
    emailVerified: true,
    id: "preview-gmail-user",
    image: null,
    mailbox: {
      displayName: "Demo Mailbox",
      emailAddress: "demo@quieter.email",
      id: "demo:mailbox",
      provider: "gmail",
    },
    name: "Gmail Preview",
  },
  managed: {
    email: "managed.preview@quieter.email",
    emailVerified: true,
    id: "preview-managed-user",
    image: null,
    mailbox: {
      displayName: "Support",
      emailAddress: "support@dev.quieter.test",
      id: "demo:managed-mailbox",
      provider: "managed",
    },
    name: "Managed Mail Preview",
  },
};

export const isPreviewPersona = (value: unknown): value is PreviewPersona =>
  typeof value === "string" && previewPersonas.includes(value as PreviewPersona);

export const isPreviewPersonasEnabled = () =>
  serverEnv.NODE_ENV === "development" || serverEnv.QUIETER_PREVIEW_PERSONAS_ENABLED === true;

export const createPreviewPersonaSessionHeaders = async (persona: PreviewPersona) => {
  if (!isPreviewPersonasEnabled()) {
    throw new Error("Preview personas are disabled.");
  }

  const currentUser = await ensurePreviewPersonaAccount(persona);
  const authContext = await auth.$context;
  const session = await authContext.internalAdapter.createSession(currentUser.id);
  const signedToken = `${session.token}.${await makeSignature(session.token, authContext.secret)}`;
  const headers = new Headers({ "cache-control": "no-store" });

  headers.append(
    "set-cookie",
    serializeCookie(
      authContext.authCookies.sessionToken.name,
      signedToken,
      authContext.authCookies.sessionToken.attributes,
    ),
  );
  headers.append("set-cookie", serializePreviewPersonaCookie(null));

  return headers;
};

export const createPreviewPersonaClearHeaders = () => {
  const headers = new Headers({ "cache-control": "no-store" });
  headers.append("set-cookie", serializePreviewPersonaCookie(null));
  return headers;
};

const ensurePreviewPersonaAccount = async (persona: PreviewPersona) => {
  const personaAccount = previewPersonaUsers[persona];
  const now = new Date();

  await db
    .insert(user)
    .values({
      createdAt: now,
      email: personaAccount.email,
      emailVerified: personaAccount.emailVerified,
      id: personaAccount.id,
      image: personaAccount.image,
      name: personaAccount.name,
      termsAcceptedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: {
        email: personaAccount.email,
        emailVerified: personaAccount.emailVerified,
        image: personaAccount.image,
        name: personaAccount.name,
        termsAcceptedAt: now,
        updatedAt: now,
      },
      target: user.id,
    });

  await db
    .insert(account)
    .values({
      accountId: persona,
      createdAt: now,
      id: `preview-account-${persona}`,
      providerId: "preview-persona",
      updatedAt: now,
      userId: personaAccount.id,
    })
    .onConflictDoUpdate({
      set: {
        updatedAt: now,
        userId: personaAccount.id,
      },
      target: [account.providerId, account.accountId],
    });

  const organizationState = await ensureUserOrganizationState(personaAccount);
  const organizationId =
    organizationState.organizationIds[0] ?? (await getUserOrganizationId(personaAccount.id));

  if (!organizationId) {
    throw new Error("Could not create preview team.");
  }

  const defaultMailboxId = personaAccount.mailbox?.id ?? null;
  if (personaAccount.mailbox) {
    await db
      .insert(mailbox)
      .values({
        createdAt: now,
        displayName: personaAccount.mailbox.displayName,
        emailAddress: personaAccount.mailbox.emailAddress,
        id: personaAccount.mailbox.id,
        organizationId,
        ownerUserId: personaAccount.mailbox.provider === "gmail" ? personaAccount.id : null,
        provider: personaAccount.mailbox.provider,
        status: "connected",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        set: {
          displayName: personaAccount.mailbox.displayName,
          emailAddress: personaAccount.mailbox.emailAddress,
          organizationId,
          ownerUserId: personaAccount.mailbox.provider === "gmail" ? personaAccount.id : null,
          provider: personaAccount.mailbox.provider,
          status: "connected",
          updatedAt: now,
        },
        target: mailbox.id,
      });
  }

  await db
    .update(user)
    .set({ defaultMailboxId, updatedAt: now })
    .where(eq(user.id, personaAccount.id));

  return personaAccount;
};

const getUserOrganizationId = async (userId: string) => {
  const [membership] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1);

  return membership?.organizationId ?? null;
};

const serializeCookie = (
  name: string,
  value: string,
  attributes: {
    domain?: string;
    httpOnly?: boolean;
    maxAge?: number;
    path?: string;
    secure?: boolean;
    sameSite?: string;
  },
) =>
  [
    `${name}=${value}`,
    attributes.maxAge == null ? null : `Max-Age=${attributes.maxAge}`,
    attributes.domain ? `Domain=${attributes.domain}` : null,
    `Path=${attributes.path ?? "/"}`,
    attributes.httpOnly ? "HttpOnly" : null,
    attributes.secure ? "Secure" : null,
    `SameSite=${formatSameSite(attributes.sameSite ?? "lax")}`,
  ]
    .filter(Boolean)
    .join("; ");

const serializePreviewPersonaCookie = (persona: PreviewPersona | null) =>
  [
    `${previewPersonaCookieName}=${persona ? encodeURIComponent(persona) : ""}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${persona ? previewPersonaCookieMaxAgeSeconds : 0}`,
  ].join("; ");

const formatSameSite = (sameSite: string) => {
  const normalized = sameSite.toLowerCase();
  if (normalized === "strict") return "Strict";
  if (normalized === "none") return "None";
  return "Lax";
};
